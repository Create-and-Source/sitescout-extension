// ============================================================
// SiteScout — Google Maps Content Script
// ============================================================
// Scrapes business data from Google Maps business listings.

(function () {
  "use strict";

  // Avoid double-injection
  if (window.__sitescout_gmaps_loaded) return;
  window.__sitescout_gmaps_loaded = true;

  // Listen for scrape requests from popup/background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCRAPE_PAGE") {
      const data = scrapeGoogleMaps();
      sendResponse({ source: "google_maps", data });
    }
    return true;
  });

  function scrapeGoogleMaps() {
    const result = {
      source: "google_maps",
      url: window.location.href,
      business: {},
      contact: {},
      details: {},
      reviews: [],
      photos: [],
    };

    try {
      // Business name — the main heading
      const nameEl =
        document.querySelector("h1.DUwDvf") ||
        document.querySelector('[data-attrid="title"]') ||
        document.querySelector("h1");
      result.business.name = nameEl?.textContent?.trim() || "";

      // Category / type
      const categoryEl =
        document.querySelector("button[jsaction*='category']") ||
        document.querySelector(".DkEaL");
      result.business.category = categoryEl?.textContent?.trim() || "";

      // Rating
      const ratingEl = document.querySelector(".F7nice span[aria-hidden]");
      result.business.rating = ratingEl?.textContent?.trim() || "";

      // Review count
      const reviewCountEl = document.querySelector(
        ".F7nice span:last-child span"
      );
      result.business.reviewCount = reviewCountEl?.textContent
        ?.replace(/[()]/g, "")
        ?.trim() || "";

      // Address
      const addressEl = document.querySelector(
        '[data-item-id="address"] .Io6YTe'
      );
      if (!addressEl) {
        // Try aria-label approach
        const addressBtn = document.querySelector(
          'button[data-item-id="address"]'
        );
        result.contact.address =
          addressBtn?.getAttribute("aria-label")?.replace("Address: ", "") || "";
      } else {
        result.contact.address = addressEl?.textContent?.trim() || "";
      }

      // Phone
      const phoneEl = document.querySelector(
        '[data-item-id^="phone:"] .Io6YTe'
      );
      if (!phoneEl) {
        const phoneBtn = document.querySelector(
          'button[data-item-id^="phone:"]'
        );
        result.contact.phone =
          phoneBtn?.getAttribute("aria-label")?.replace("Phone: ", "") || "";
      } else {
        result.contact.phone = phoneEl?.textContent?.trim() || "";
      }

      // Website
      const websiteEl = document.querySelector(
        '[data-item-id="authority"] .Io6YTe'
      );
      if (!websiteEl) {
        const websiteLink = document.querySelector(
          'a[data-item-id="authority"]'
        );
        result.contact.website = websiteLink?.href || "";
      } else {
        result.contact.website = websiteEl?.textContent?.trim() || "";
      }

      // Hours
      const hoursRows = document.querySelectorAll(
        ".t39EBf.GUrTXd table tr, .OqCZI tr"
      );
      result.details.hours = [];
      hoursRows.forEach((row) => {
        const day = row.querySelector("td:first-child")?.textContent?.trim();
        const time = row.querySelector("td:last-child")?.textContent?.trim();
        if (day && time) {
          result.details.hours.push({ day, time });
        }
      });

      // If hours table not found, try the summary
      if (result.details.hours.length === 0) {
        const hoursSummary = document.querySelector(".o0Svhf, .t39EBf");
        if (hoursSummary) {
          result.details.hoursSummary = hoursSummary.textContent?.trim() || "";
        }
      }

      // Services / attributes (dine-in, takeout, delivery, etc.)
      const serviceEls = document.querySelectorAll(
        ".LTs0Rc, .qty3Ue .hpLkke span"
      );
      result.details.services = [];
      serviceEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && !result.details.services.includes(text)) {
          result.details.services.push(text);
        }
      });

      // Also grab from the "About" tab attributes
      const attrEls = document.querySelectorAll(".ClesNd, .E0DTEd");
      attrEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && !result.details.services.includes(text)) {
          result.details.services.push(text);
        }
      });

      // Price level
      const priceEl = document.querySelector(".mgr77e .rGaJuf, .phX1ge");
      result.business.priceLevel = priceEl?.textContent?.trim() || "";

      // Reviews (first 5)
      const reviewEls = document.querySelectorAll(".jftiEf");
      reviewEls.forEach((el, i) => {
        if (i >= 5) return;
        const text = el.querySelector(".wiI7pd")?.textContent?.trim() || "";
        const rating =
          el.querySelector(".kvMYJc")?.getAttribute("aria-label") || "";
        const author = el.querySelector(".d4r55")?.textContent?.trim() || "";
        const time = el.querySelector(".rsqaWe")?.textContent?.trim() || "";
        if (text) {
          result.reviews.push({ author, rating, time, text });
        }
      });

      // Photos (first 10 image URLs)
      const photoEls = document.querySelectorAll(
        ".U39Pmb, .ZKr5Yb img, .p0Vshd img"
      );
      photoEls.forEach((el, i) => {
        if (i >= 10) return;
        const src =
          el.style?.backgroundImage?.match(/url\("(.+?)"\)/)?.[1] ||
          el.src ||
          "";
        if (src && !src.includes("data:image")) {
          result.photos.push(src);
        }
      });

      // Description / editorial summary
      const descEl = document.querySelector(
        ".WeS02d.fontBodyMedium, .PYvSYb"
      );
      result.business.description = descEl?.textContent?.trim() || "";

      // Menu link (for restaurants)
      const menuLink = document.querySelector(
        'a[data-item-id="menu"], a[aria-label*="Menu"]'
      );
      result.details.menuUrl = menuLink?.href || "";
    } catch (err) {
      result.error = err.message;
    }

    return result;
  }
})();
