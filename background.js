// ============================================================
// SiteScout — Background Service Worker (Autonomous Hunting)
// ============================================================
// The brain. Finds trending industries, hunts businesses with
// weak websites, scrapes them, analyzes gaps, saves as leads.
// You just enter your city — the tool does everything.

const CRM_API_URL = "https://sitescout-crm.vercel.app";

// ── Config ───────────────────────────────────────────────────

async function getConfig() {
  const result = await chrome.storage.sync.get([
    "crmApiUrl",
    "apiKey",
    "claudeApiKey",
    "serpApiKey",
  ]);
  return {
    crmApiUrl: result.crmApiUrl || CRM_API_URL,
    apiKey: result.apiKey || "",
    claudeApiKey: result.claudeApiKey || "",
    serpApiKey: result.serpApiKey || "",
  };
}

// ── Message router ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "FIND_TRENDING_INDUSTRIES":
      return findTrendingIndustries(message.location);

    case "HUNT_INDUSTRY":
      return huntIndustry(
        message.location,
        message.industry,
        message.reason
      );

    case "GET_LEADS":
      return getLeadsFromStorage();

    case "SAVE_LEAD":
      return saveLead(message.data);

    case "GET_CONFIG":
      return getConfig();

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ═════════════════════════════════════════════════════════════
// STEP 1: Find what's hot in this location
// ═════════════════════════════════════════════════════════════

async function findTrendingIndustries(location) {
  const config = await getConfig();
  if (!config.claudeApiKey) {
    throw new Error("Add your Claude API key in Settings first");
  }

  const response = await callClaude(
    config.claudeApiKey,
    `You are a market research AI for a web design agency called Create & Source.

Given this location: "${location}"

Identify 5-7 industries/business types that are HOT right now in or near this area — businesses that should be thriving because the market is booming, but many of them have terrible, outdated, or no websites.

Think about:
- Industries where demand is surging (medspas, mobile detailing, wellness, specialty fitness, etc.)
- Seasonal trends for this time of year
- Local economic trends for this specific area
- Businesses where a great website would directly drive more revenue (online booking, e-commerce, memberships)
- Industries where the owners are too busy running the business to fix their website

Return ONLY a JSON object:
{
  "industries": [
    {
      "name": "medspas",
      "searchQuery": "medspa near Scottsdale AZ",
      "hot": true,
      "reason": "Medspa industry growing 15% YoY, Scottsdale is a hotspot but many still have 2015-era sites"
    }
  ]
}

The "searchQuery" should be what you'd type into Google Maps to find these businesses. Be specific to the location.`
  );

  return parseJSON(response);
}

// ═════════════════════════════════════════════════════════════
// STEP 2: Find businesses in an industry, scrape + score them
// ═════════════════════════════════════════════════════════════

async function huntIndustry(location, industry, reason) {
  const config = await getConfig();

  // Search for businesses using SerpAPI (Google Maps results)
  let businesses;
  if (config.serpApiKey) {
    businesses = await searchBusinessesSerpApi(
      config.serpApiKey,
      industry,
      location
    );
  } else {
    // Fallback: use Claude to generate likely businesses
    // (less accurate but works without SerpAPI)
    businesses = await findBusinessesViaClaude(
      config.claudeApiKey,
      industry,
      location
    );
  }

  if (!businesses || businesses.length === 0) {
    return { leads: [] };
  }

  // For each business, scrape their website and analyze
  const leads = [];

  for (const biz of businesses) {
    try {
      // Scrape their website if they have one
      let websiteData = null;
      if (biz.website) {
        try {
          websiteData = await scrapeWebsite(biz.website);
        } catch {
          // Site might be down or blocked — that's a signal too
          websiteData = { error: "Could not load website", url: biz.website };
        }
      }

      // AI analysis — is this site weak? What are the gaps?
      const analysis = await analyzeBusinessForLeadGen(
        config.claudeApiKey,
        biz,
        websiteData,
        industry,
        reason
      );

      // Only save as a lead if the site is actually weak
      if (
        analysis &&
        analysis.currentSiteQuality !== "good" &&
        analysis.gaps &&
        analysis.gaps.length > 0
      ) {
        const lead = {
          id: crypto.randomUUID(),
          ...analysis,
          contact: {
            phone: biz.phone || "",
            address: biz.address || "",
            website: biz.website || "",
            email: websiteData?.contact?.email || "",
          },
          scrapedData: websiteData,
          industry,
          location,
          status: "analyzed",
          savedAt: new Date().toISOString(),
        };

        await saveLead(lead);
        leads.push(lead);
      }
    } catch {
      // Skip this business, move on
    }
  }

  return { leads };
}

// ═════════════════════════════════════════════════════════════
// Search for businesses via SerpAPI (Google Maps Local Results)
// ═════════════════════════════════════════════════════════════

async function searchBusinessesSerpApi(apiKey, industry, location) {
  const query = `${industry} in ${location}`;
  const url = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(query)}&api_key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("SerpAPI request failed");
  const data = await res.json();

  const results = data.local_results || [];
  return results.slice(0, 10).map((r) => ({
    name: r.title || "",
    address: r.address || "",
    phone: r.phone || "",
    website: r.website || "",
    rating: r.rating || 0,
    reviews: r.reviews || 0,
    type: r.type || "",
    thumbnail: r.thumbnail || "",
    hours: r.hours || "",
    priceLevel: r.price || "",
  }));
}

// ═════════════════════════════════════════════════════════════
// Fallback: Use Claude to identify likely businesses to check
// (When no SerpAPI key — still useful, just less precise)
// ═════════════════════════════════════════════════════════════

async function findBusinessesViaClaude(claudeApiKey, industry, location) {
  const response = await callClaude(
    claudeApiKey,
    `You are helping a web design agency find businesses with weak websites.

Industry: ${industry}
Location: ${location}

Search your knowledge for real businesses in this industry and location that likely have poor or no websites. Think about:
- Small local businesses that are well-reviewed but have terrible web presence
- Businesses you know exist in this area
- The types of businesses in this industry that typically have bad sites

Return ONLY a JSON object:
{
  "businesses": [
    {
      "name": "Example Business Name",
      "address": "123 Main St, City, ST",
      "phone": "(555) 123-4567",
      "website": "https://example.com",
      "rating": 4.5,
      "reviews": 200,
      "type": "medspa"
    }
  ]
}

Include 5-8 real businesses if you know them, or realistic examples for this area. Include their actual website URLs if you know them. If you don't know real ones, make educated guesses about the types of businesses that exist there.`
  );

  const parsed = parseJSON(response);
  return parsed.businesses || [];
}

// ═════════════════════════════════════════════════════════════
// Scrape a website (opens in background tab)
// ═════════════════════════════════════════════════════════════

async function scrapeWebsite(url) {
  // Ensure URL has protocol
  if (!url.startsWith("http")) url = "https://" + url;

  const tab = await chrome.tabs.create({ url, active: false });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onComplete);
      chrome.tabs.remove(tab.id).catch(() => {});
      resolve({ error: "Website timed out", url });
    }, 12000);

    const onComplete = async (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(onComplete);
      clearTimeout(timeout);

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/generic.js"],
        });

        await new Promise((r) => setTimeout(r, 800));

        chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE" }, (res) => {
          chrome.tabs.remove(tab.id).catch(() => {});
          if (chrome.runtime.lastError || !res) {
            resolve({ error: "Scrape failed", url });
          } else {
            resolve(res.data || res);
          }
        });
      } catch {
        chrome.tabs.remove(tab.id).catch(() => {});
        resolve({ error: "Could not scrape", url });
      }
    };

    chrome.tabs.onUpdated.addListener(onComplete);
  });
}

// ═════════════════════════════════════════════════════════════
// AI: Analyze a business for lead generation potential
// ═════════════════════════════════════════════════════════════

async function analyzeBusinessForLeadGen(
  claudeApiKey,
  businessInfo,
  websiteData,
  industry,
  trendReason
) {
  const prompt = `You are SiteScout, an AI for Create & Source, a web design agency. You analyze businesses to find ones losing money because of their weak online presence.

CONTEXT:
- Industry trend: "${industry}" — ${trendReason}
- This industry is hot right now, meaning businesses WITH great websites are pulling ahead

BUSINESS INFO (from Google Maps / directory):
${JSON.stringify(businessInfo, null, 2)}

THEIR CURRENT WEBSITE DATA (scraped):
${websiteData ? JSON.stringify(websiteData, null, 2) : "NO WEBSITE FOUND — this business has zero web presence"}

ANALYZE THIS BUSINESS:
1. How bad is their current website? (none, poor, average, good)
2. What specific revenue opportunities are they missing because of their weak web presence?
3. What would a great website do for them given their industry is trending?

If their site is "good" — they don't need us. Skip them.
If their site is "none", "poor", or "average" — they're leaving money on the table.

Think about what SPECIFIC features they're missing:
- Online booking/scheduling
- Online ordering (food, services)
- E-commerce / merch store
- Membership/subscription program
- Gift cards
- Client reviews showcase
- Before/after gallery
- Email capture / marketing
- Mobile optimization
- Professional photography
- SEO basics
- Social media integration

Return ONLY a JSON object:
{
  "businessName": "the name",
  "businessType": "specific type",
  "currentSiteQuality": "none | poor | average | good",
  "gaps": [
    {
      "gap": "No online booking",
      "impact": "high",
      "explanation": "Medspas with online booking see 40% more appointments"
    }
  ],
  "gapSummary": "2-3 sentences explaining what they're missing and WHY it matters given the industry trend. Written like you're telling the business owner to their face.",
  "recommendedFeatures": ["online booking", "before/after gallery", "gift cards"],
  "lovablePrompt": "A COMPLETE, DETAILED prompt for Lovable to build this business a stunning modern website. Include: exact business name, type, a premium color scheme that fits their brand, every page needed, every feature to include, all content sections, and specific functionality. Make it so detailed that Lovable builds a production-ready site. The design should be modern, premium, and make the business owner say 'I NEED this.' Reference their actual services, location, and branding if available.",
  "emailSubject": "compelling email subject line",
  "emailBody": "The full outreach email (3-4 paragraphs). Tone: we saw a gap where they could attract more clients. We built them a preview. No pressure. Just showing what's possible. Sign off as Create & Source.",
  "estimatedRevenueImpact": "$X,000/month in potential revenue they're missing"
}`;

  const response = await callClaude(claudeApiKey, prompt);
  return parseJSON(response);
}

// ═════════════════════════════════════════════════════════════
// Claude API helper
// ═════════════════════════════════════════════════════════════

async function callClaude(apiKey, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// ═════════════════════════════════════════════════════════════
// Storage
// ═════════════════════════════════════════════════════════════

async function saveLead(leadData) {
  const leads = await getLeadsFromStorage();

  // Deduplicate by business name
  const existing = leads.findIndex(
    (l) =>
      l.businessName?.toLowerCase() === leadData.businessName?.toLowerCase()
  );
  if (existing >= 0) {
    leads[existing] = { ...leads[existing], ...leadData };
  } else {
    leads.unshift(leadData);
  }

  await chrome.storage.local.set({ leads });

  // Sync to CRM if configured
  const config = await getConfig();
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
      // CRM sync failed, saved locally
    }
  }

  return { success: true, leadCount: leads.length };
}

async function getLeadsFromStorage() {
  const result = await chrome.storage.local.get(["leads"]);
  return result.leads || [];
}

// ═════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════

function parseJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse AI response");
  return JSON.parse(match[0]);
}

// ── Badge ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "options/options.html" });
  }
});
