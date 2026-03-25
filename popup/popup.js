// ============================================================
// SiteScout — Popup Script (Autonomous Hunting)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // ── Elements ──
  const autoHuntBtn = document.getElementById("autoHuntBtn");
  const huntBtn = document.getElementById("huntBtn");
  const locationInput = document.getElementById("locationInput");
  const industryInput = document.getElementById("industryInput");
  const progressSection = document.getElementById("progressSection");
  const progressCounter = document.getElementById("progressCounter");
  const progressFill = document.getElementById("progressFill");
  const liveFeed = document.getElementById("liveFeed");
  const trendingTags = document.getElementById("trendingTags");
  const stopBtn = document.getElementById("stopBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const leadCountEl = document.getElementById("leadCount");
  const leadsList = document.getElementById("leadsList");
  const leadDetail = document.getElementById("leadDetail");

  let huntStopped = false;

  // ── Load saved location ──
  chrome.storage.sync.get(["lastLocation"], (r) => {
    if (r.lastLocation) locationInput.value = r.lastLocation;
  });

  // ── Tab switching ──
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`${btn.dataset.tab}View`).classList.add("active");
      if (btn.dataset.tab === "leads") {
        leadDetail.classList.remove("active");
        leadDetail.innerHTML = "";
        loadLeads();
      }
    });
  });

  settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

  // ── Auto Hunt (AI picks the industries) ──
  autoHuntBtn.addEventListener("click", async () => {
    const location = locationInput.value.trim();
    if (!location) {
      locationInput.style.borderColor = "#C00";
      locationInput.focus();
      setTimeout(() => (locationInput.style.borderColor = "#E5E5E5"), 2000);
      return;
    }

    chrome.storage.sync.set({ lastLocation: location });
    startHunt(location, null);
  });

  // ── Manual Industry Hunt ──
  huntBtn.addEventListener("click", async () => {
    const location = locationInput.value.trim();
    const industry = industryInput.value.trim();
    if (!location) {
      locationInput.style.borderColor = "#C00";
      locationInput.focus();
      setTimeout(() => (locationInput.style.borderColor = "#E5E5E5"), 2000);
      return;
    }
    if (!industry) {
      industryInput.style.borderColor = "#C00";
      industryInput.focus();
      setTimeout(() => (industryInput.style.borderColor = "#E5E5E5"), 2000);
      return;
    }

    chrome.storage.sync.set({ lastLocation: location });
    startHunt(location, industry);
  });

  // ── Stop ──
  stopBtn.addEventListener("click", () => {
    huntStopped = true;
    stopBtn.classList.remove("visible");
    addFeedItem("skip", "Hunt stopped by user");
  });

  // ── Start the hunt ──
  async function startHunt(location, industry) {
    huntStopped = false;
    autoHuntBtn.disabled = true;
    huntBtn.disabled = true;
    progressSection.classList.add("visible");
    stopBtn.classList.add("visible");
    liveFeed.innerHTML = "";
    trendingTags.style.display = "none";
    trendingTags.innerHTML = "";
    progressFill.style.width = "0%";
    progressCounter.textContent = "0 leads found";

    let leadCount = 0;

    try {
      if (!industry) {
        // Step 1: AI finds trending industries for this location
        addFeedItem("searching", `Researching what's hot in <strong>${esc(location)}</strong>...`);
        progressFill.style.width = "5%";

        const trends = await sendMessage({
          type: "FIND_TRENDING_INDUSTRIES",
          location,
        });

        if (trends.error) {
          addFeedItem("skip", `Error: ${trends.error}`);
          return;
        }

        // Show trending tags
        trendingTags.style.display = "flex";
        (trends.industries || []).forEach((ind) => {
          const tag = document.createElement("span");
          tag.className = `trend-tag${ind.hot ? " hot" : ""}`;
          tag.textContent = ind.name;
          trendingTags.appendChild(tag);
        });

        addFeedItem("found", `Found <strong>${trends.industries.length} trending industries</strong>`);
        progressFill.style.width = "10%";

        // Step 2: Hunt in each industry
        const industries = trends.industries || [];
        for (let i = 0; i < industries.length; i++) {
          if (huntStopped) break;

          const ind = industries[i];
          const pct = 10 + ((i + 1) / industries.length) * 85;
          progressFill.style.width = `${pct}%`;

          addFeedItem("searching", `Searching for <strong>${esc(ind.name)}</strong> in ${esc(location)}...`);

          const results = await sendMessage({
            type: "HUNT_INDUSTRY",
            location,
            industry: ind.name,
            reason: ind.reason,
          });

          if (huntStopped) break;
          if (results.error) {
            addFeedItem("skip", `${esc(ind.name)}: ${results.error}`);
            continue;
          }

          const leads = results.leads || [];
          for (const lead of leads) {
            leadCount++;
            progressCounter.textContent = `${leadCount} leads found`;
            addFeedItem(
              "done",
              `<strong>${esc(lead.businessName)}</strong> — ${esc(lead.gapSummary || lead.gaps?.[0]?.gap || "needs a better site")}`
            );
          }

          if (leads.length === 0) {
            addFeedItem("skip", `${esc(ind.name)}: no weak websites found (all looking good)`);
          }
        }
      } else {
        // Direct industry hunt
        addFeedItem("searching", `Searching for <strong>${esc(industry)}</strong> in <strong>${esc(location)}</strong>...`);
        progressFill.style.width = "20%";

        const results = await sendMessage({
          type: "HUNT_INDUSTRY",
          location,
          industry,
          reason: "User-specified industry",
        });

        progressFill.style.width = "80%";

        if (results.error) {
          addFeedItem("skip", `Error: ${results.error}`);
          return;
        }

        const leads = results.leads || [];
        for (const lead of leads) {
          leadCount++;
          progressCounter.textContent = `${leadCount} leads found`;
          addFeedItem(
            "done",
            `<strong>${esc(lead.businessName)}</strong> — ${esc(lead.gapSummary || lead.gaps?.[0]?.gap || "needs a better site")}`
          );
        }

        if (leads.length === 0) {
          addFeedItem("skip", "No weak websites found in this industry here");
        }
      }

      progressFill.style.width = "100%";
      addFeedItem("done", `<strong>Hunt complete! ${leadCount} leads ready.</strong>`);
      updateLeadCount();
    } catch (err) {
      addFeedItem("skip", `Error: ${err.message}`);
    } finally {
      autoHuntBtn.disabled = false;
      huntBtn.disabled = false;
      stopBtn.classList.remove("visible");
    }
  }

  // ── Feed helper ──
  function addFeedItem(type, html) {
    const icons = {
      searching: "&#128270;",
      found: "&#9889;",
      analyzing: "&#129504;",
      done: "&#9989;",
      skip: "&#9898;",
    };

    const item = document.createElement("div");
    item.className = "feed-item";
    item.innerHTML = `
      <div class="feed-icon ${type}">${icons[type] || "&#8226;"}</div>
      <div class="feed-text">${html}</div>
    `;
    liveFeed.prepend(item);
  }

  // ── Leads ──
  async function loadLeads() {
    const leads = await sendMessage({ type: "GET_LEADS" });
    const container = leadsList;

    if (!leads || leads.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No leads yet.</p>
          <p>Go to Hunt tab and enter your city.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = leads
      .map(
        (lead, i) => `
      <div class="lead-card" data-index="${i}">
        <div class="lead-top">
          <div>
            <div class="lead-name">${esc(lead.businessName || "Unknown")}</div>
            <div class="lead-category">${esc(lead.businessType || lead.industry || "")}</div>
          </div>
          <span class="lead-status ${lead.status || "analyzed"}">${lead.status || "analyzed"}</span>
        </div>
        ${
          lead.gaps && lead.gaps.length > 0
            ? `<div class="lead-gaps">${lead.gaps
                .slice(0, 3)
                .map((g) => `<span class="gap-tag">${esc(g.gap)}</span>`)
                .join("")}</div>`
            : ""
        }
        ${lead.currentSiteQuality ? `<div class="lead-score">Current site: ${esc(lead.currentSiteQuality)}</div>` : ""}
      </div>
    `
      )
      .join("");

    // Click handler for lead detail
    container.querySelectorAll(".lead-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = parseInt(card.dataset.index);
        showLeadDetail(leads[idx]);
      });
    });
  }

  function showLeadDetail(lead) {
    leadsList.style.display = "none";
    leadDetail.classList.add("active");

    leadDetail.innerHTML = `
      <button class="back-btn" id="backToLeads">&larr; Back to leads</button>
      <div class="detail-name">${esc(lead.businessName || "Unknown")}</div>
      <div class="detail-category">${esc(lead.businessType || "")} &middot; ${esc(lead.contact?.address || lead.scrapedData?.contact?.address || "")}</div>

      ${
        lead.gapSummary
          ? `<div class="detail-section"><h4>Opportunity</h4><p>${esc(lead.gapSummary)}</p></div>`
          : ""
      }

      ${
        lead.gaps && lead.gaps.length
          ? `<div class="detail-section">
              <h4>Revenue Gaps</h4>
              ${lead.gaps
                .map(
                  (g) => `
                <div class="gap-item">
                  <div class="impact-dot ${g.impact}"></div>
                  <div>
                    <div class="gap-text">${esc(g.gap)}</div>
                    <div class="gap-explain">${esc(g.explanation)}</div>
                  </div>
                </div>
              `
                )
                .join("")}
            </div>`
          : ""
      }

      ${
        lead.lovablePrompt
          ? `<div class="detail-section">
              <h4>Lovable Prompt</h4>
              <div class="prompt-preview">${esc(lead.lovablePrompt)}</div>
            </div>`
          : ""
      }

      <div class="detail-actions">
        ${lead.lovablePrompt ? '<button class="action-btn primary" id="copyPromptBtn">Copy Prompt & Open Lovable</button>' : ""}
        ${lead.contact?.phone || lead.scrapedData?.contact?.phone ? `<button class="action-btn secondary" id="callLeadBtn">Call ${esc(lead.contact?.phone || lead.scrapedData?.contact?.phone)}</button>` : ""}
        ${lead.contact?.email || lead.scrapedData?.contact?.email ? `<button class="action-btn secondary" id="emailLeadBtn">Email ${esc(lead.contact?.email || lead.scrapedData?.contact?.email)}</button>` : ""}
      </div>
    `;

    leadDetail.querySelector("#backToLeads").addEventListener("click", () => {
      leadDetail.classList.remove("active");
      leadDetail.innerHTML = "";
      leadsList.style.display = "block";
    });

    const copyBtn = leadDetail.querySelector("#copyPromptBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(lead.lovablePrompt);
        copyBtn.textContent = "Copied!";
        chrome.tabs.create({ url: "https://lovable.dev/projects" });
      });
    }
  }

  async function updateLeadCount() {
    const leads = await sendMessage({ type: "GET_LEADS" });
    const count = leads?.length || 0;
    leadCountEl.textContent = count > 0 ? `(${count})` : "";
  }

  // ── Helpers ──
  function esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── Init ──
  updateLeadCount();
});
