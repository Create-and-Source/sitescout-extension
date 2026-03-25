// ============================================================
// SiteScout — Popup Script
// ============================================================
// The popup just DISPLAYS hunt progress from background storage.
// All hunting runs in the background worker — popup can close
// and reopen without losing anything.

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
  const leadsActions = document.getElementById("leadsActions");
  const sendToCrmBtn = document.getElementById("sendToCrmBtn");
  const generatePromptsBtn = document.getElementById("generatePromptsBtn");
  const copyAllBtn = document.getElementById("copyAllBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");

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

  // ── Auto Hunt ──
  autoHuntBtn.addEventListener("click", () => {
    const location = locationInput.value.trim();
    if (!location) {
      locationInput.style.borderColor = "#C00";
      locationInput.focus();
      setTimeout(() => (locationInput.style.borderColor = "#E5E5E5"), 2000);
      return;
    }
    chrome.storage.sync.set({ lastLocation: location });
    sendMessage({ type: "START_HUNT", location });
  });

  // ── Industry Hunt ──
  huntBtn.addEventListener("click", () => {
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
    sendMessage({ type: "START_HUNT", location, industry });
  });

  // ── Stop ──
  stopBtn.addEventListener("click", () => {
    sendMessage({ type: "STOP_HUNT" });
  });

  // ── Listen for storage changes (live updates from background) ──
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.huntStatus) {
      renderHuntStatus(changes.huntStatus.newValue);
    }
    if (changes.leads) {
      updateLeadCount();
      // Re-render leads list if leads tab is active
      const leadsTabActive = document.querySelector('.tab-btn[data-tab="leads"]')?.classList.contains("active");
      if (leadsTabActive && !leadDetail.classList.contains("active")) {
        loadLeads();
      }
    }
  });

  // ── Render hunt status from storage ──
  function renderHuntStatus(status) {
    if (!status) return;

    if (status.running || status.feed?.length > 0) {
      progressSection.classList.add("visible");
    }

    // Buttons
    autoHuntBtn.disabled = status.running;
    huntBtn.disabled = status.running;
    stopBtn.classList.toggle("visible", status.running);

    // Progress bar
    progressFill.style.width = `${status.progress || 0}%`;
    progressCounter.textContent = `${status.leadCount || 0} leads found`;

    // Trending tags
    if (status.trends && status.trends.length > 0) {
      trendingTags.style.display = "flex";
      trendingTags.innerHTML = status.trends
        .map(
          (ind) =>
            `<span class="trend-tag${ind.hot ? " hot" : ""}">${esc(ind.name)}</span>`
        )
        .join("");
    }

    // Feed items
    if (status.feed) {
      const icons = {
        searching: "&#128270;",
        found: "&#9889;",
        analyzing: "&#129504;",
        done: "&#9989;",
        skip: "&#9898;",
      };

      liveFeed.innerHTML = status.feed
        .map(
          (item) => `
        <div class="feed-item">
          <div class="feed-icon ${item.type}">${icons[item.type] || "&#8226;"}</div>
          <div class="feed-text">${esc(item.text)}</div>
        </div>
      `
        )
        .join("");
    }
  }

  // ── Leads ──
  async function loadLeads() {
    const leads = await sendMessage({ type: "GET_LEADS" });
    const container = leadsList;

    if (!leads || leads.length === 0) {
      leadsActions.style.display = "none";
      container.innerHTML = `
        <div class="empty-state">
          <p>No leads yet.</p>
          <p>Go to Hunt tab and enter your city.</p>
        </div>
      `;
      return;
    }

    leadsActions.style.display = "flex";

    // Show how many need prompts
    const needPrompts = leads.filter(l => !l.lovablePrompt).length;
    if (needPrompts > 0) {
      generatePromptsBtn.textContent = `Generate ${needPrompts} Missing Prompts`;
      generatePromptsBtn.style.display = "";
    } else {
      generatePromptsBtn.style.display = "none";
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
      <div class="detail-category">${esc(lead.businessType || "")} &middot; ${esc(lead.contact?.address || "")}</div>

      ${lead.gapSummary ? `<div class="detail-section"><h4>Opportunity</h4><p>${esc(lead.gapSummary)}</p></div>` : ""}

      ${
        lead.gaps?.length
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
                </div>`
                )
                .join("")}
            </div>`
          : ""
      }

      ${lead.estimatedRevenueImpact ? `<div class="detail-section"><h4>Estimated Revenue Impact</h4><p>${esc(lead.estimatedRevenueImpact)}</p></div>` : ""}

      ${
        lead.lovablePrompt
          ? `<div class="detail-section">
              <h4>Lovable Prompt</h4>
              <div class="prompt-preview">${esc(lead.lovablePrompt)}</div>
            </div>`
          : ""
      }

      ${
        lead.emailBody
          ? `<div class="detail-section">
              <h4>Draft Email (needs your approval to send)</h4>
              <div class="prompt-preview">${esc(lead.emailSubject ? `Subject: ${lead.emailSubject}\n\n` : "")}${esc(lead.emailBody)}</div>
            </div>`
          : ""
      }

      <div class="detail-actions">
        ${lead.lovablePrompt ? '<button class="action-btn primary" id="copyPromptBtn">Copy Prompt & Open Lovable</button>' : ""}
        ${lead.contact?.phone ? `<button class="action-btn secondary" id="callLeadBtn">Call ${esc(lead.contact.phone)}</button>` : ""}
        ${lead.contact?.website ? `<button class="action-btn secondary" id="visitSiteBtn">Visit Current Site</button>` : ""}
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

    const visitBtn = leadDetail.querySelector("#visitSiteBtn");
    if (visitBtn) {
      visitBtn.addEventListener("click", () => {
        let url = lead.contact.website;
        if (!url.startsWith("http")) url = "https://" + url;
        chrome.tabs.create({ url });
      });
    }
  }

  async function updateLeadCount() {
    const leads = await sendMessage({ type: "GET_LEADS" });
    const count = leads?.length || 0;
    leadCountEl.textContent = count > 0 ? `(${count})` : "";
  }

  // ── Send to CRM ──
  sendToCrmBtn.addEventListener("click", async () => {
    sendToCrmBtn.disabled = true;
    sendToCrmBtn.textContent = "Sending...";
    try {
      const result = await sendMessage({ type: "SEND_TO_CRM" });
      if (result?.success) {
        sendToCrmBtn.textContent = "Sent!";
        sendToCrmBtn.classList.add("success");
        setTimeout(() => {
          sendToCrmBtn.textContent = "Send to CRM";
          sendToCrmBtn.classList.remove("success");
          sendToCrmBtn.disabled = false;
        }, 3000);
      } else {
        sendToCrmBtn.textContent = result?.error || "Failed";
        setTimeout(() => {
          sendToCrmBtn.textContent = "Send to CRM";
          sendToCrmBtn.disabled = false;
        }, 3000);
      }
    } catch (err) {
      sendToCrmBtn.textContent = "Error";
      setTimeout(() => {
        sendToCrmBtn.textContent = "Send to CRM";
        sendToCrmBtn.disabled = false;
      }, 3000);
    }
  });

  // ── Generate missing prompts ──
  generatePromptsBtn.addEventListener("click", async () => {
    generatePromptsBtn.disabled = true;
    generatePromptsBtn.textContent = "Generating... (runs in background)";
    try {
      const result = await sendMessage({ type: "GENERATE_MISSING_PROMPTS" });
      generatePromptsBtn.textContent = result?.message || "Started!";
    } catch {
      generatePromptsBtn.textContent = "Failed — check Claude API key";
    }
    setTimeout(() => {
      generatePromptsBtn.disabled = false;
      loadLeads();
    }, 3000);
  });

  // ── Copy all leads as JSON ──
  copyAllBtn.addEventListener("click", async () => {
    const leads = await sendMessage({ type: "GET_LEADS" });
    if (!leads || leads.length === 0) {
      copyAllBtn.textContent = "No leads";
      setTimeout(() => (copyAllBtn.textContent = "Copy All as JSON"), 2000);
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(leads, null, 2));
    copyAllBtn.textContent = "Copied!";
    copyAllBtn.classList.add("success");
    setTimeout(() => {
      copyAllBtn.textContent = "Copy All as JSON";
      copyAllBtn.classList.remove("success");
    }, 2000);
  });

  // ── Clear all leads ──
  clearAllBtn.addEventListener("click", async () => {
    if (!confirm("Delete all leads? This cannot be undone.")) return;
    await sendMessage({ type: "CLEAR_ALL_LEADS" });
    loadLeads();
    updateLeadCount();
  });

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

  // ── Init: load current state ──
  async function init() {
    updateLeadCount();

    // Check if a hunt is already running or has results
    const status = await sendMessage({ type: "GET_HUNT_STATUS" });
    if (status && (status.running || status.feed?.length > 0)) {
      renderHuntStatus(status);
    }
  }

  init();
});
