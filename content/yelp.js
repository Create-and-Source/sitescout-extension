// ============================================================
// SiteScout — Yelp Content Script
// ============================================================
// Scrapes business data from Yelp business pages.

(function () {
  "use strict";

  if (window.__sitescout_yelp_loaded) return;
  window.__sitescout_yelp_loaded = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCRAPE_PAGE") {
      const data = scrapeYelp();
      sendResponse({ source: "yelp", data });
    }
    return true;
  });

  function scrapeYelp() {
    const result = {
      source: "yelp",
      url: window.location.href,
      business: {},
      contact: {},
      details: {},
      reviews: [],
      photos: [],
    };

    try {
      // Business name
      const nameEl = document.querySelector("h1");
      result.business.name = nameEl?.textContent?.trim() || "";

      // Category
      const categoryLinks = document.querySelectorAll(
        '[class*="categories"] a, .arrange-unit a[href*="/search?find_desc"]'
      );
      result.business.categories = [];
      categoryLinks.forEach((a) => {
        const text = a.textContent?.trim();
        if (text) result.business.categories.push(text);
      });
      result.business.category = result.business.categories[0] || "";

      // Rating
      const ratingEl = document.querySelector(
        '[aria-label*="star rating"], [class*="five-stars"]'
      );
      result.business.rating =
        ratingEl
          ?.getAttribute("aria-label")
          ?.match(/([\d.]+)/)?.[1] || "";

      // Review count
      const reviewCountEl = document.querySelector(
        'a[href="#reviews"], [class*="reviewCount"]'
      );
      result.business.reviewCount =
        reviewCountEl?.textContent?.match(/(\d+)/)?.[1] || "";

      // Price level
      const priceEl = document.querySelector(
        '[class*="priceRange"], .priceRange'
      );
      result.business.priceLevel = priceEl?.textContent?.trim() || "";

      // Address — look for the address section
      const addressEl = document.querySelector(
        'address, [class*="map-box"] p, a[href*="get_directions"]'
      );
      if (addressEl) {
        result.contact.address = addressEl.textContent
          ?.replace(/Get Directions/gi, "")
          ?.trim() || "";
      }

      // Phone
      const phoneEl = document.querySelector(
        'p[class*="phone"], [class*="phone"] p'
      );
      if (!phoneEl) {
        // Try to find phone from sidebar info
        const sidebarItems = document.querySelectorAll(
          ".css-1p9ibgf, .arrange-unit"
        );
        sidebarItems.forEach((item) => {
          const text = item.textContent || "";
          const phoneMatch = text.match(
            /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
          );
          if (phoneMatch && !result.contact.phone) {
            result.contact.phone = phoneMatch[0];
          }
        });
      } else {
        result.contact.phone = phoneEl.textContent?.trim() || "";
      }

      // Website
      const websiteLink = document.querySelector(
        'a[href*="/biz_redir"], a[class*="website"]'
      );
      result.contact.website = websiteLink?.href || "";

      // Hours
      const hoursTable = document.querySelector(
        'table[class*="hours"], .hours-table'
      );
      result.details.hours = [];
      if (hoursTable) {
        hoursTable.querySelectorAll("tr").forEach((row) => {
          const cells = row.querySelectorAll("td, th, p");
          if (cells.length >= 2) {
            result.details.hours.push({
              day: cells[0].textContent?.trim(),
              time: cells[1].textContent?.trim(),
            });
          }
        });
      }

      // Services / highlights
      result.details.services = [];
      const highlightEls = document.querySelectorAll(
        '[class*="amenities"] span, [class*="highlight"] span'
      );
      highlightEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 50) {
          result.details.services.push(text);
        }
      });

      // Reviews (first 5)
      const reviewEls = document.querySelectorAll(
        '[class*="review__"] li, .review, [class*="reviewContent"]'
      );
      reviewEls.forEach((el, i) => {
        if (i >= 5) return;
        const text =
          el.querySelector("p span, .comment p, [lang]")?.textContent?.trim() ||
          "";
        const author =
          el.querySelector("a[class*='user'], .user-display-name")
            ?.textContent?.trim() || "";
        const rating =
          el
            .querySelector('[aria-label*="star"]')
            ?.getAttribute("aria-label") || "";
        if (text) {
          result.reviews.push({ author, rating, text });
        }
      });

      // Photos
      const photoEls = document.querySelectorAll(
        '.photo-box-img, [class*="photo"] img, .biz-photos img'
      );
      photoEls.forEach((el, i) => {
        if (i >= 10) return;
        const src = el.src || el.dataset?.src || "";
        if (src && !src.includes("data:image")) {
          result.photos.push(src);
        }
      });

      // Description
      const descEl = document.querySelector(
        '[class*="fromBusiness"] p, .from-biz-owner p'
      );
      result.business.description = descEl?.textContent?.trim() || "";
    } catch (err) {
      result.error = err.message;
    }

    return result;
  }
})();
