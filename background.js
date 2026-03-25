// ============================================================
// SiteScout — Background Service Worker (Autonomous Hunting)
// ============================================================
// The brain. Uses Google News to find what's hot, Google Maps
// to find real businesses, scrapes their sites, AI scores them,
// and builds your lead pipeline. You just enter your city.

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
    case "START_HUNT":
      // Kick off the hunt in the background — returns immediately
      startFullHunt(message.location, message.industry || null);
      return { started: true };

    case "STOP_HUNT":
      huntState.stopped = true;
      await updateHuntStatus({ running: false, status: "Stopped" });
      return { stopped: true };

    case "GET_HUNT_STATUS":
      return getHuntStatus();

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
// Hunt state — persisted to storage so popup can read it
// ═════════════════════════════════════════════════════════════

const huntState = { stopped: false };

async function getHuntStatus() {
  const result = await chrome.storage.local.get(["huntStatus"]);
  return result.huntStatus || { running: false, feed: [], leadCount: 0, trends: [] };
}

async function updateHuntStatus(updates) {
  const current = await getHuntStatus();
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ huntStatus: updated });
}

async function addFeedItem(type, text) {
  const current = await getHuntStatus();
  const feed = current.feed || [];
  feed.unshift({ type, text, time: Date.now() });
  // Keep last 50 items
  if (feed.length > 50) feed.length = 50;
  await updateHuntStatus({ feed });
}

// ═════════════════════════════════════════════════════════════
// FULL HUNT — runs entirely in the background
// ═════════════════════════════════════════════════════════════

async function startFullHunt(location, specificIndustry) {
  huntState.stopped = false;

  await updateHuntStatus({
    running: true,
    location,
    status: "Starting hunt...",
    feed: [],
    leadCount: 0,
    trends: [],
    progress: 0,
  });

  const config = await getConfig();
  if (!config.claudeApiKey) {
    await addFeedItem("skip", "Error: Add your Claude API key in Settings first");
    await updateHuntStatus({ running: false, status: "Error" });
    return;
  }

  let leadCount = 0;

  try {
    let industries;

    if (specificIndustry) {
      // User specified an industry — just hunt that one
      industries = [{ name: specificIndustry, searchQuery: `${specificIndustry} in ${location}`, hot: true, reason: "User-specified industry" }];
      await addFeedItem("searching", `Searching for ${specificIndustry} in ${location}...`);
    } else {
      // STEP 1: Find trending industries
      await addFeedItem("searching", `Researching what's hot in ${location}...`);
      await updateHuntStatus({ status: "Researching trends...", progress: 5 });

      const trends = await findTrendingIndustries(location);
      industries = trends.industries || [];

      await updateHuntStatus({ trends: industries, progress: 10 });
      await addFeedItem("found", `Found ${industries.length} trending industries`);
    }

    // STEP 2: Hunt each industry
    for (let i = 0; i < industries.length; i++) {
      if (huntState.stopped) break;

      const ind = industries[i];
      const pct = specificIndustry ? 20 : 10 + ((i + 1) / industries.length) * 85;

      await updateHuntStatus({ status: `Hunting ${ind.name}...`, progress: pct });
      await addFeedItem("searching", `Searching for ${ind.name} in ${location}...`);

      try {
        const results = await huntIndustry(location, ind.name, ind.reason);

        if (huntState.stopped) break;

        const newLeads = results.leads || [];
        for (const lead of newLeads) {
          leadCount++;
          await updateHuntStatus({ leadCount });
          await addFeedItem("done", `${lead.businessName} — ${lead.gapSummary || lead.gaps?.[0]?.gap || "needs a better site"}`);
        }

        if (newLeads.length === 0) {
          await addFeedItem("skip", `${ind.name}: no weak websites found`);
        }
      } catch (err) {
        await addFeedItem("skip", `${ind.name}: ${err.message}`);
      }
    }

    await updateHuntStatus({ running: false, status: "Complete", progress: 100 });
    await addFeedItem("done", `Hunt complete! ${leadCount} leads ready.`);
  } catch (err) {
    await addFeedItem("skip", `Error: ${err.message}`);
    await updateHuntStatus({ running: false, status: "Error" });
  }
}

// ═════════════════════════════════════════════════════════════
// STEP 1: Find what's ACTUALLY hot — Google Trends + News + Claude
// ═════════════════════════════════════════════════════════════

async function findTrendingIndustries(location) {
  const config = await getConfig();
  if (!config.claudeApiKey) {
    throw new Error("Add your Claude API key in Settings first");
  }

  let newsContext = "";
  let trendsContext = "";

  if (config.serpApiKey) {
    // Pull REAL data in parallel: Google News + Google Trends
    const [newsData, trendsData] = await Promise.allSettled([
      fetchLocalNews(config.serpApiKey, location),
      fetchGoogleTrends(config.serpApiKey, location),
    ]);

    if (newsData.status === "fulfilled") newsContext = newsData.value;
    if (trendsData.status === "fulfilled") trendsContext = trendsData.value;
  }

  const response = await callClaude(
    config.claudeApiKey,
    `You are a market research AI for a web design agency called Create & Source.

Location: "${location}"

${
  trendsContext
    ? `GOOGLE TRENDS DATA (real, pulled just now):
${trendsContext}
`
    : ""
}
${
  newsContext
    ? `REAL NEWS HEADLINES from this area (from Google News just now):
${newsContext}
`
    : ""
}
${!trendsContext && !newsContext ? "Use your knowledge of current market trends for this area." : "Use this REAL trend data and news to identify what's actually growing."}

Identify 5-7 industries/business types that are HOT right now in or near this area — businesses that should be thriving because the market is booming, but many of them have terrible, outdated, or no websites.

Think about:
- Industries where demand is surging (medspas, mobile detailing, wellness, specialty fitness, etc.)
- Seasonal trends for this time of year (March 2026)
- Local economic trends for this specific area
- Businesses where a great website would directly drive more revenue (online booking, e-commerce, memberships)
- Industries where the owners are too busy running the business to fix their website
- Businesses in the news — new openings, booming sectors, areas with construction/growth
- What Google Trends shows is rising in search volume

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

The "searchQuery" should be what you'd type into Google Maps to find these businesses. Be specific to the location. Make "hot" true for the top 3 hottest industries.`
  );

  return parseJSON(response);
}

// ── Fetch real local news via SerpAPI Google News ────────────

async function fetchLocalNews(serpApiKey, location) {
  const queries = [
    `${location} new business opening`,
    `${location} booming industry growth`,
    `${location} local business`,
  ];

  let allHeadlines = [];

  for (const q of queries) {
    try {
      const url =
        `https://serpapi.com/search.json?engine=google_news` +
        `&q=${encodeURIComponent(q)}` +
        `&gl=us&hl=en` +
        `&api_key=${serpApiKey}`;

      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      const results = data.news_results || [];
      for (const article of results.slice(0, 5)) {
        allHeadlines.push({
          title: article.title,
          snippet: article.snippet || "",
          source: article.source?.name || "",
          date: article.iso_date || article.date || "",
        });
      }
    } catch {
      // Skip failed query
    }
  }

  if (allHeadlines.length === 0) return "";

  return allHeadlines
    .slice(0, 15)
    .map(
      (h) =>
        `- "${h.title}" (${h.source}, ${h.date})${h.snippet ? ` — ${h.snippet}` : ""}`
    )
    .join("\n");
}

// ── Fetch Google Trends data for local service industries ────

async function fetchGoogleTrends(serpApiKey, location) {
  // Extract state/region code from location for geo param
  const stateMatch = location.match(
    /\b(AZ|CA|TX|FL|NY|NV|CO|WA|OR|IL|GA|NC|SC|TN|OH|PA|VA|MA|NJ|MD|MI|MN|MO|IN|WI|CT|AL|LA|KY|OK|UT|AR|MS|KS|IA|NE|ID|HI|NM|WV|NH|ME|RI|MT|DE|SD|ND|AK|VT|WY|DC)\b/i
  );
  const geo = stateMatch ? `US-${stateMatch[1].toUpperCase()}` : "US";

  // Check trending searches for key service industries
  const industries = [
    "medspa",
    "auto detailing",
    "personal trainer",
    "nail salon",
    "barbershop",
    "restaurant",
    "yoga studio",
    "pet grooming",
    "landscaping",
    "cleaning service",
  ];

  const query = industries.slice(0, 5).join(",");

  try {
    const url =
      `https://serpapi.com/search.json?engine=google_trends` +
      `&q=${encodeURIComponent(query)}` +
      `&geo=${geo}` +
      `&data_type=TIMESERIES` +
      `&date=today+3-m` +
      `&api_key=${serpApiKey}`;

    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();

    // Get averages to see which industries are trending highest
    const averages = data.interest_over_time?.averages || [];
    if (averages.length === 0) return "";

    let result = "Search interest averages (last 3 months):\n";
    result += averages
      .sort((a, b) => b.value - a.value)
      .map((a) => `- "${a.query}": ${a.value}/100 interest`)
      .join("\n");

    // Also get related rising queries
    try {
      const relUrl =
        `https://serpapi.com/search.json?engine=google_trends` +
        `&q=${encodeURIComponent(industries[0])}` +
        `&geo=${geo}` +
        `&data_type=RELATED_QUERIES` +
        `&date=today+3-m` +
        `&api_key=${serpApiKey}`;

      const relRes = await fetch(relUrl);
      if (relRes.ok) {
        const relData = await relRes.json();
        const rising = relData.related_queries?.rising || [];
        if (rising.length > 0) {
          result += "\n\nRising search queries:\n";
          result += rising
            .slice(0, 8)
            .map((r) => `- "${r.query}" (${r.value})`)
            .join("\n");
        }
      }
    } catch {
      // Rising queries failed, continue with what we have
    }

    return result;
  } catch {
    return "";
  }
}

// ── Fetch Google Maps Reviews for a business ─────────────────

async function fetchBusinessReviews(serpApiKey, placeId) {
  if (!placeId) return null;

  try {
    const url =
      `https://serpapi.com/search.json?engine=google_maps_reviews` +
      `&place_id=${encodeURIComponent(placeId)}` +
      `&sort_by=newestFirst` +
      `&num=10` +
      `&hl=en` +
      `&api_key=${serpApiKey}`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const reviews = (data.reviews || []).map((r) => ({
      rating: r.rating,
      text: r.snippet || r.extracted_snippet?.original || "",
      date: r.iso_date || r.date || "",
      author: r.user?.name || "",
      likes: r.likes || 0,
    }));

    // Get topic keywords (what people talk about most)
    const topics = (data.topics || []).map((t) => ({
      keyword: t.keyword,
      mentions: t.mentions,
    }));

    return { reviews, topics, placeInfo: data.place_info || {} };
  } catch {
    return null;
  }
}

// ═════════════════════════════════════════════════════════════
// STEP 2: Find REAL businesses via SerpAPI Google Maps
// ═════════════════════════════════════════════════════════════

async function huntIndustry(location, industry, reason) {
  const config = await getConfig();

  // Search Google Maps for real businesses
  let businesses;
  if (config.serpApiKey) {
    businesses = await searchGoogleMaps(
      config.serpApiKey,
      industry,
      location
    );
  } else {
    // Fallback without SerpAPI
    businesses = await findBusinessesViaClaude(
      config.claudeApiKey,
      industry,
      location
    );
  }

  if (!businesses || businesses.length === 0) {
    return { leads: [] };
  }

  // For each business, scrape their website, pull reviews, and analyze
  const leads = [];

  for (const biz of businesses) {
    try {
      // Scrape their website + pull reviews in parallel
      const [websiteResult, reviewsResult] = await Promise.allSettled([
        biz.website
          ? scrapeWebsite(biz.website).catch(() => ({
              error: "Could not load website",
              url: biz.website,
            }))
          : Promise.resolve(null),
        config.serpApiKey && biz.placeId
          ? fetchBusinessReviews(config.serpApiKey, biz.placeId)
          : Promise.resolve(null),
      ]);

      const websiteData =
        websiteResult.status === "fulfilled" ? websiteResult.value : null;
      const reviewsData =
        reviewsResult.status === "fulfilled" ? reviewsResult.value : null;

      // AI analysis — is this site weak? What are the gaps?
      const analysis = await analyzeBusinessForLeadGen(
        config.claudeApiKey,
        biz,
        websiteData,
        reviewsData,
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
          googleMapsData: {
            rating: biz.rating,
            reviews: biz.reviews,
            placeId: biz.placeId,
            thumbnail: biz.thumbnail,
            openState: biz.openState,
            serviceOptions: biz.serviceOptions,
            unclaimed: biz.unclaimed,
          },
          reviewsData: reviewsData || null,
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

// ── SerpAPI Google Maps search ───────────────────────────────

async function searchGoogleMaps(serpApiKey, industry, location) {
  const query = `${industry} in ${location}`;
  const url =
    `https://serpapi.com/search.json?engine=google_maps` +
    `&type=search` +
    `&q=${encodeURIComponent(query)}` +
    `&hl=en` +
    `&api_key=${serpApiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google Maps search failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const results = data.local_results || [];

  return results.slice(0, 10).map((r) => ({
    name: r.title || "",
    placeId: r.place_id || "",
    dataCid: r.data_cid || "",
    address: r.address || "",
    phone: r.phone || "",
    website: r.website || "",
    rating: r.rating || 0,
    reviews: r.reviews || 0,
    price: r.price || "",
    type: r.type || "",
    types: r.types || [],
    description: r.description || "",
    openState: r.open_state || "",
    hours: r.operating_hours || {},
    serviceOptions: r.service_options || {},
    thumbnail: r.thumbnail || "",
    unclaimed: r.unclaimed_listing || false,
    gps: r.gps_coordinates || {},
  }));
}

// ── Fallback: Claude guesses businesses (no SerpAPI) ─────────

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

Include 5-8 real businesses if you know them. Include their actual website URLs if you know them.`
  );

  const parsed = parseJSON(response);
  return parsed.businesses || [];
}

// ═════════════════════════════════════════════════════════════
// Scrape a website (opens in background tab)
// ═════════════════════════════════════════════════════════════

async function scrapeWebsite(url) {
  if (!url.startsWith("http")) url = "https://" + url;

  const tab = await chrome.tabs.create({ url, active: false });

  return new Promise((resolve) => {
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
// AI: Analyze a business — score site quality, find gaps
// ═════════════════════════════════════════════════════════════

async function analyzeBusinessForLeadGen(
  claudeApiKey,
  businessInfo,
  websiteData,
  reviewsData,
  industry,
  trendReason
) {
  // Build context about what Google Maps already tells us
  const gmapsSignals = [];
  if (businessInfo.unclaimed) gmapsSignals.push("UNCLAIMED Google listing — owner is not managing their online presence at all");
  if (!businessInfo.website) gmapsSignals.push("NO WEBSITE listed on Google Maps");
  if (businessInfo.reviews > 50 && businessInfo.rating >= 4.0) gmapsSignals.push(`${businessInfo.reviews} reviews at ${businessInfo.rating} stars — customers love them but their web presence doesn't reflect it`);
  if (businessInfo.serviceOptions?.delivery && !businessInfo.website) gmapsSignals.push("Offers delivery but has no website for online ordering");
  if (businessInfo.serviceOptions?.takeout) gmapsSignals.push("Offers takeout — online ordering would be huge");

  const prompt = `You are SiteScout, an AI for Create & Source, a web design agency. You analyze businesses to find ones losing money because of their weak online presence.

CONTEXT:
- Industry trend: "${industry}" — ${trendReason}
- This industry is hot right now, meaning businesses WITH great websites are pulling ahead

BUSINESS INFO FROM GOOGLE MAPS (real data):
Name: ${businessInfo.name}
Type: ${businessInfo.type} ${businessInfo.types?.length ? `(${businessInfo.types.join(", ")})` : ""}
Address: ${businessInfo.address}
Phone: ${businessInfo.phone || "NOT LISTED"}
Website: ${businessInfo.website || "NONE"}
Rating: ${businessInfo.rating}/5 (${businessInfo.reviews} reviews)
Price: ${businessInfo.price || "unknown"}
Status: ${businessInfo.openState || "unknown"}
Hours: ${JSON.stringify(businessInfo.hours)}
Services: ${JSON.stringify(businessInfo.serviceOptions)}
Unclaimed listing: ${businessInfo.unclaimed ? "YES — owner hasn't claimed their Google listing" : "No"}
Description: ${businessInfo.description || "none"}

RED FLAGS ALREADY DETECTED:
${gmapsSignals.length > 0 ? gmapsSignals.map((s) => `- ${s}`).join("\n") : "- None obvious from listing alone"}

THEIR CURRENT WEBSITE (scraped):
${
  websiteData && !websiteData.error
    ? JSON.stringify(websiteData, null, 2)
    : websiteData?.error
      ? `WEBSITE ERROR: ${websiteData.error} (${websiteData.url})`
      : "NO WEBSITE — this business has zero web presence"
}

${
  reviewsData
    ? `REAL CUSTOMER REVIEWS (from Google Maps):
Top topics customers mention: ${reviewsData.topics?.map((t) => `${t.keyword} (${t.mentions} mentions)`).join(", ") || "none"}

Recent reviews:
${reviewsData.reviews
  ?.slice(0, 5)
  .map((r) => `- ${r.rating}/5 stars: "${r.text?.slice(0, 200)}"`)
  .join("\n") || "none"}

USE THESE REVIEWS TO:
- Find pain points customers mention (long waits = needs online booking, "hard to find" = needs better SEO, "wish they had online ordering" = obvious gap)
- Identify what customers love (use this in the website copy)
- Spot opportunities the business is missing`
    : ""
}

ANALYZE:
1. Rate their current site: none | poor | average | good
2. What specific revenue they're missing
3. What a great website would do for them

If their site is "good" — skip them (return currentSiteQuality: "good" with empty gaps).

Return ONLY a JSON object:
{
  "businessName": "${businessInfo.name}",
  "businessType": "specific type",
  "currentSiteQuality": "none | poor | average | good",
  "gaps": [
    {
      "gap": "No online booking",
      "impact": "high",
      "explanation": "Medspas with online booking see 40% more appointments"
    }
  ],
  "gapSummary": "2-3 sentences explaining what they're missing and WHY it matters. Written directly to the business owner.",
  "recommendedFeatures": ["online booking", "before/after gallery", "gift cards"],
  "lovablePrompt": "A COMPLETE, DETAILED prompt for Lovable to build this business a stunning modern website. Include: exact business name '${businessInfo.name}', their actual address '${businessInfo.address}', type, a premium color scheme, every page needed, every feature, all content sections, specific functionality. Reference their real services, real location, real hours. The design should be modern, premium, mobile-first. Make the business owner say 'I NEED this.'",
  "emailSubject": "compelling email subject line",
  "emailBody": "The full outreach email draft (3-4 paragraphs). Tone: we found a gap where they could attract more clients. We built them a free preview. No pressure. Just showing what's possible. Sign off as Create & Source. IMPORTANT: This is a DRAFT — it will NOT be sent without review and approval.",
  "estimatedRevenueImpact": "$X,000/month in potential revenue they're missing"
}`;

  const response = await callClaude(claudeApiKey, prompt);
  return parseJSON(response);
}

// ═════════════════════════════════════════════════════════════
// Claude API helper
// ═════════════════════════════════════════════════════════════

async function callClaude(apiKey, prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
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

    if (res.ok) {
      const data = await res.json();
      return data.content[0].text;
    }

    // Retry on overloaded (529) or rate limit (429) or server errors (500+)
    if ((res.status === 529 || res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = attempt * 3000; // 3s, 6s, 9s
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }
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

// ── Install ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "options/options.html" });
  }
});
