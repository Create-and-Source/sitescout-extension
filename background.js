// ============================================================
// SiteScout — Background Service Worker
// ============================================================
// Orchestrates scraping, AI analysis, and CRM communication.

const CRM_API_URL = "https://sitescout-crm.vercel.app";

// ── Storage helpers ──────────────────────────────────────────

async function getConfig() {
  const result = await chrome.storage.sync.get([
    "crmApiUrl",
    "apiKey",
    "claudeApiKey",
  ]);
  return {
    crmApiUrl: result.crmApiUrl || CRM_API_URL,
    apiKey: result.apiKey || "",
    claudeApiKey: result.claudeApiKey || "",
  };
}

// ── Detect page type ─────────────────────────────────────────

function detectPageType(url) {
  if (!url) return "unknown";
  if (url.includes("google.com/maps") || url.includes("maps.google.com"))
    return "google_maps";
  if (url.includes("yelp.com/biz")) return "yelp";
  return "generic";
}

// ── Message handlers ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "SCRAPE_CURRENT_TAB":
      return scrapeCurrentTab();

    case "SCRAPE_WEBSITE":
      return scrapeWebsite(message.url);

    case "ANALYZE_BUSINESS":
      return analyzeBusiness(message.data);

    case "SAVE_LEAD":
      return saveLead(message.data);

    case "GET_LEADS":
      return getLeads();

    case "FULL_PIPELINE":
      return fullPipeline(message.data);

    case "GET_CONFIG":
      return getConfig();

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ── Scrape the current active tab ────────────────────────────

async function scrapeCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");

  const pageType = detectPageType(tab.url);

  // For Google Maps and Yelp, content scripts are already injected
  if (pageType === "google_maps" || pageType === "yelp") {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // For generic sites, inject the script dynamically
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/generic.js"],
  });

  // After injection, send the scrape message
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    }, 300);
  });
}

// ── Scrape a specific website URL ────────────────────────────

async function scrapeWebsite(url) {
  // Open the URL in a background tab, scrape it, close it
  const tab = await chrome.tabs.create({ url, active: false });

  return new Promise((resolve, reject) => {
    const onComplete = async (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(onComplete);

      try {
        // Inject generic scraper
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/generic.js"],
        });

        // Wait for page to settle
        await new Promise((r) => setTimeout(r, 500));

        // Scrape
        chrome.tabs.sendMessage(
          tab.id,
          { type: "SCRAPE_PAGE" },
          (response) => {
            chrome.tabs.remove(tab.id);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      } catch (err) {
        chrome.tabs.remove(tab.id);
        reject(err);
      }
    };

    chrome.tabs.onUpdated.addListener(onComplete);

    // Timeout after 15 seconds
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onComplete);
      chrome.tabs.remove(tab.id).catch(() => {});
      reject(new Error("Scraping timed out"));
    }, 15000);
  });
}

// ── AI Analysis — Claude analyzes business and identifies gaps ──

async function analyzeBusiness(scrapedData) {
  const config = await getConfig();

  if (!config.claudeApiKey) {
    throw new Error(
      "Claude API key not configured. Go to extension options to set it up."
    );
  }

  const prompt = buildAnalysisPrompt(scrapedData);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.claudeApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const result = await response.json();
  const text = result.content[0].text;

  // Parse the JSON response from Claude
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not parse AI analysis");

  return JSON.parse(jsonMatch[0]);
}

function buildAnalysisPrompt(data) {
  return `You are SiteScout, an AI that analyzes businesses and identifies opportunities for a better website.

Analyze this business data and return a JSON response with:
1. A gap analysis — what revenue opportunities is this business missing online?
2. A complete Lovable prompt to build them a modern, professional website

Business Data:
${JSON.stringify(data, null, 2)}

Return ONLY a JSON object with this exact structure:
{
  "businessName": "the business name",
  "businessType": "restaurant | retail | service | fitness | salon | medical | other",
  "currentSiteQuality": "none | poor | average | good",
  "gaps": [
    {
      "gap": "short description of the missing opportunity",
      "impact": "high | medium | low",
      "explanation": "why this matters for revenue"
    }
  ],
  "gapSummary": "2-3 sentence summary of the biggest opportunities this business is missing, written as if speaking to the business owner",
  "recommendedFeatures": ["online ordering", "membership program", "booking system", etc],
  "lovablePrompt": "A complete, detailed prompt for Lovable to build this business a modern website. Include: business name, type, color scheme (suggest colors based on their branding or industry), pages needed, features to include, content sections, and any specific functionality like online ordering, booking, merch store, etc. Make it specific and detailed enough that Lovable can build a complete site from this prompt alone. The site should look premium and modern.",
  "emailSubject": "subject line for the outreach email",
  "emailPreview": "2-3 sentence preview of what the email would say about the gaps found"
}`;
}

// ── Full Pipeline: Scrape → Analyze → Save ───────────────────

async function fullPipeline(data) {
  // Step 1: Use provided scraped data or scrape current tab
  let scrapedData = data?.scrapedData;
  if (!scrapedData) {
    const scrapeResult = await scrapeCurrentTab();
    scrapedData = scrapeResult.data || scrapeResult;
  }

  // Step 2: If the business has a website, also scrape that
  let websiteData = null;
  const websiteUrl =
    scrapedData.contact?.website || scrapedData.business?.website;
  if (websiteUrl && !websiteUrl.includes("google.com") && !websiteUrl.includes("yelp.com")) {
    try {
      const wsResult = await scrapeWebsite(websiteUrl);
      websiteData = wsResult.data || wsResult;
    } catch {
      // Website scrape failed, continue without it
    }
  }

  // Merge website data if we got it
  const combinedData = websiteData
    ? { listing: scrapedData, website: websiteData }
    : scrapedData;

  // Step 3: AI Analysis
  const analysis = await analyzeBusiness(combinedData);

  // Step 4: Save as lead
  const lead = {
    ...analysis,
    scrapedData: combinedData,
    status: "analyzed",
    createdAt: new Date().toISOString(),
  };

  await saveLead(lead);

  return { success: true, lead, analysis };
}

// ── CRM API calls ────────────────────────────────────────────

async function saveLead(leadData) {
  const config = await getConfig();

  // Save locally first
  const leads = await getLeadsFromStorage();
  leads.unshift({
    id: crypto.randomUUID(),
    ...leadData,
    savedAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ leads });

  // If CRM is configured, also sync to CRM
  if (config.apiKey && config.crmApiUrl) {
    try {
      await fetch(`${config.crmApiUrl}/api/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(leadData),
      });
    } catch {
      // CRM sync failed, lead is saved locally
    }
  }

  return { success: true, leadCount: leads.length };
}

async function getLeads() {
  return getLeadsFromStorage();
}

async function getLeadsFromStorage() {
  const result = await chrome.storage.local.get(["leads"]);
  return result.leads || [];
}

// ── Badge ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const pageType = detectPageType(tab.url);
  if (pageType !== "unknown") {
    chrome.action.setBadgeText({ tabId, text: "S" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#000000" });
  }
});

// ── Install handler ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "options/options.html" });
  }
});
