// ============================================================
// SiteScout — Generic Website Scraper
// ============================================================
// Scrapes any business website for branding, content, and structure.
// Injected programmatically via chrome.scripting.executeScript.

(function () {
  "use strict";

  function scrapeGenericSite() {
    const result = {
      source: "generic_website",
      url: window.location.href,
      business: {},
      contact: {},
      branding: {},
      structure: {},
      content: {},
      photos: [],
    };

    try {
      // ── Business name ──
      // Try meta tags first, then <title>, then h1
      result.business.name =
        document.querySelector('meta[property="og:site_name"]')?.content ||
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector("title")?.textContent?.split("|")[0]?.trim() ||
        document.querySelector("h1")?.textContent?.trim() ||
        "";

      // ── Description ──
      result.business.description =
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content ||
        "";

      // ── Contact info ──
      // Phone — scan for phone patterns
      const bodyText = document.body?.innerText || "";
      const phoneMatch = bodyText.match(
        /(?:tel:|phone:|call\s*:?\s*)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i
      );
      result.contact.phone = phoneMatch ? phoneMatch[0].trim() : "";

      // Email — scan for email patterns
      const emailMatch = bodyText.match(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
      );
      result.contact.email = emailMatch ? emailMatch[0] : "";

      // Also check mailto links
      if (!result.contact.email) {
        const mailtoLink = document.querySelector('a[href^="mailto:"]');
        result.contact.email =
          mailtoLink?.href?.replace("mailto:", "")?.split("?")?.[0] || "";
      }

      // Address — look for common address patterns
      const addressEl = document.querySelector(
        "address, .address, #address, [itemprop='address'], [class*='address']"
      );
      result.contact.address = addressEl?.textContent?.trim() || "";

      // Website (self)
      result.contact.website = window.location.origin;

      // ── Branding ──
      // Logo
      const logoEl =
        document.querySelector(
          'img[class*="logo"], img[id*="logo"], img[alt*="logo"], .logo img, #logo img, header img'
        ) || document.querySelector("header img");
      result.branding.logoUrl = logoEl?.src || "";
      result.branding.logoAlt = logoEl?.alt || "";

      // Colors — extract from computed styles
      const colors = new Set();
      const colorElements = document.querySelectorAll(
        "header, nav, h1, h2, .hero, [class*='hero'], footer, a, button"
      );
      colorElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const fg = style.color;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          colors.add(bg);
        }
        if (fg) colors.add(fg);
      });
      result.branding.colors = [...colors].slice(0, 10);

      // Fonts
      const fonts = new Set();
      document.querySelectorAll("h1, h2, h3, p, a, button").forEach((el) => {
        const family = window.getComputedStyle(el).fontFamily;
        if (family) fonts.add(family.split(",")[0].trim().replace(/['"]/g, ""));
      });
      result.branding.fonts = [...fonts].slice(0, 5);

      // Favicon
      const faviconEl =
        document.querySelector('link[rel="icon"]') ||
        document.querySelector('link[rel="shortcut icon"]');
      result.branding.favicon = faviconEl?.href || "";

      // ── Site structure ──
      // Navigation links
      const navLinks = [];
      document.querySelectorAll("nav a, header a, .nav a, .menu a").forEach(
        (a) => {
          const text = a.textContent?.trim();
          const href = a.href;
          if (text && text.length < 30 && href) {
            navLinks.push({ text, href });
          }
        }
      );
      result.structure.navigation = navLinks.slice(0, 15);

      // Page sections / headings
      const headings = [];
      document.querySelectorAll("h1, h2, h3").forEach((h) => {
        const text = h.textContent?.trim();
        if (text && text.length > 2 && text.length < 100) {
          headings.push({ tag: h.tagName, text });
        }
      });
      result.structure.headings = headings.slice(0, 20);

      // ── Content ──
      // Hero text
      const heroEl = document.querySelector(
        '.hero, [class*="hero"], [class*="banner"], .jumbotron, section:first-of-type'
      );
      result.content.heroText = heroEl?.textContent?.trim()?.slice(0, 500) || "";

      // Services / menu items
      const serviceEls = document.querySelectorAll(
        '.service, .services li, [class*="service"] h3, [class*="menu-item"], .card h3, .card-title'
      );
      result.content.services = [];
      serviceEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length < 100) {
          result.content.services.push(text);
        }
      });
      result.content.services = result.content.services.slice(0, 20);

      // Social links
      const socialLinks = [];
      document
        .querySelectorAll(
          'a[href*="facebook"], a[href*="instagram"], a[href*="twitter"], a[href*="linkedin"], a[href*="tiktok"], a[href*="youtube"]'
        )
        .forEach((a) => {
          socialLinks.push(a.href);
        });
      result.contact.socialLinks = [...new Set(socialLinks)];

      // ── Photos ──
      const seenSrcs = new Set();
      document.querySelectorAll("img").forEach((img) => {
        const src = img.src || img.dataset?.src || "";
        if (
          src &&
          !src.includes("data:image") &&
          !src.includes("pixel") &&
          !src.includes("tracking") &&
          !src.includes("1x1") &&
          img.naturalWidth > 100 &&
          !seenSrcs.has(src)
        ) {
          seenSrcs.add(src);
          result.photos.push({
            src,
            alt: img.alt || "",
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        }
      });
      result.photos = result.photos.slice(0, 15);

      // ── Tech detection ──
      result.structure.tech = [];
      if (document.querySelector("[data-reactroot], #__next, #root"))
        result.structure.tech.push("React");
      if (document.querySelector("#__nuxt, [data-v-]"))
        result.structure.tech.push("Vue");
      if (document.querySelector("[ng-app], [ng-controller], app-root"))
        result.structure.tech.push("Angular");
      if (document.querySelector('meta[name="generator"][content*="WordPress"]'))
        result.structure.tech.push("WordPress");
      if (document.querySelector('meta[name="generator"][content*="Wix"]'))
        result.structure.tech.push("Wix");
      if (document.querySelector('meta[name="generator"][content*="Squarespace"]'))
        result.structure.tech.push("Squarespace");
      if (document.querySelector('[class*="shopify"], [data-shopify]'))
        result.structure.tech.push("Shopify");
      if (document.querySelector('meta[name="generator"][content*="Weebly"]'))
        result.structure.tech.push("Weebly");
      if (document.querySelector('meta[name="generator"][content*="GoDaddy"]'))
        result.structure.tech.push("GoDaddy");

      // ── Page quality signals ──
      result.structure.hasSsl = window.location.protocol === "https:";
      result.structure.isMobileResponsive = !!document.querySelector(
        'meta[name="viewport"]'
      );
      result.structure.hasAnalytics = !!(
        document.querySelector('script[src*="google-analytics"]') ||
        document.querySelector('script[src*="gtag"]') ||
        document.querySelector('script[src*="facebook"]')
      );
    } catch (err) {
      result.error = err.message;
    }

    return result;
  }

  // If called via message
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCRAPE_PAGE") {
      const data = scrapeGenericSite();
      sendResponse({ source: "generic_website", data });
    }
    return true;
  });

  // If injected programmatically, return result immediately
  if (typeof __sitescout_return_result !== "undefined") {
    return scrapeGenericSite();
  }
})();
