// ============================================================
// SiteScout — Popup Script
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // ── Elements ──
  const scanBtn = document.getElementById("scanBtn");
  const scanStatus = document.getElementById("scanStatus");
  const resultsContainer = document.getElementById("resultsContainer");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const buildBtn = document.getElementById("buildBtn");
  const saveLeadBtn = document.getElementById("saveLeadBtn");
  const fullPipelineBtn = document.getElementById("fullPipelineBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const leadCountEl = document.getElementById("leadCount");

  // ── State ──
  let scrapedData = null;
  let analysisData = null;

  // ── Tab switching ──
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`${btn.dataset.tab}View`).classList.add("active");

      if (btn.dataset.tab === "leads") loadLeads();
    });
  });

  // ── Settings ──
  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Scan ──
  scanBtn.addEventListener("click", async () => {
    setStatus("Scanning page...", "");
    scanBtn.disabled = true;
    scanBtn.classList.add("scanning");
    scanBtn.textContent = "Scanning...";

    try {
      const response = await sendMessage({ type: "SCRAPE_CURRENT_TAB" });

      if (response.error) {
        setStatus(response.error, "error");
        return;
      }

      scrapedData = response.data || response;
      displayScrapedData(scrapedData);
      resultsContainer.style.display = "block";
      setStatus("Page scanned successfully", "success");
    } catch (err) {
      setStatus(`Scan failed: ${err.message}`, "error");
    } finally {
      scanBtn.disabled = false;
      scanBtn.classList.remove("scanning");
      scanBtn.textContent = "Scan This Page";
    }
  });

  // ── Analyze ──
  analyzeBtn.addEventListener("click", async () => {
    if (!scrapedData) return;

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing with AI...";
    setStatus("Claude is analyzing the business and finding gaps...", "");

    try {
      const response = await sendMessage({
        type: "ANALYZE_BUSINESS",
        data: scrapedData,
      });

      if (response.error) {
        setStatus(response.error, "error");
        return;
      }

      analysisData = response;
      displayAnalysis(response);
      setStatus("Analysis complete!", "success");

      // Show build button
      buildBtn.style.display = "block";
      analyzeBtn.style.display = "none";
    } catch (err) {
      setStatus(`Analysis failed: ${err.message}`, "error");
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Analyze & Find Gaps";
    }
  });

  // ── Build on Lovable ──
  buildBtn.addEventListener("click", async () => {
    if (!analysisData?.lovablePrompt) return;

    // Copy prompt to clipboard
    await navigator.clipboard.writeText(analysisData.lovablePrompt);
    setStatus("Lovable prompt copied! Opening Lovable...", "success");

    // Open Lovable in new tab
    chrome.tabs.create({ url: "https://lovable.dev/projects" });
  });

  // ── Save Lead ──
  saveLeadBtn.addEventListener("click", async () => {
    if (!scrapedData) return;

    saveLeadBtn.disabled = true;
    saveLeadBtn.textContent = "Saving...";

    try {
      const leadData = {
        scrapedData,
        analysis: analysisData || null,
        businessName:
          scrapedData.business?.name ||
          analysisData?.businessName ||
          "Unknown",
        status: analysisData ? "analyzed" : "scraped",
        createdAt: new Date().toISOString(),
      };

      const response = await sendMessage({
        type: "SAVE_LEAD",
        data: leadData,
      });

      if (response.error) {
        setStatus(response.error, "error");
      } else {
        setStatus(
          `Lead saved! (${response.leadCount} total)`,
          "success"
        );
        updateLeadCount();
      }
    } catch (err) {
      setStatus(`Save failed: ${err.message}`, "error");
    } finally {
      saveLeadBtn.disabled = false;
      saveLeadBtn.textContent = "Save as Lead";
    }
  });

  // ── Full Pipeline ──
  fullPipelineBtn.addEventListener("click", async () => {
    fullPipelineBtn.disabled = true;
    fullPipelineBtn.textContent = "Running pipeline...";
    setStatus("Running full pipeline: Scan → Analyze → Save...", "");

    try {
      const response = await sendMessage({
        type: "FULL_PIPELINE",
        data: { scrapedData },
      });

      if (response.error) {
        setStatus(response.error, "error");
        return;
      }

      scrapedData = response.lead?.scrapedData || scrapedData;
      analysisData = response.analysis;

      if (analysisData) {
        displayScrapedData(scrapedData);
        displayAnalysis(analysisData);
        resultsContainer.style.display = "block";
        buildBtn.style.display = "block";
        analyzeBtn.style.display = "none";
      }

      setStatus("Pipeline complete! Site prompt ready.", "success");
      updateLeadCount();
    } catch (err) {
      setStatus(`Pipeline failed: ${err.message}`, "error");
    } finally {
      fullPipelineBtn.disabled = false;
      fullPipelineBtn.textContent = "Full Pipeline (Scan → Build → Email)";
    }
  });

  // ── Display helpers ──

  function displayScrapedData(data) {
    const biz = data.business || {};
    const contact = data.contact || {};

    document.getElementById("bizName").textContent =
      biz.name || "Unknown Business";
    document.getElementById("bizCategory").textContent =
      biz.category || biz.categories?.join(", ") || "Business";
    document.getElementById("bizPhone").textContent = contact.phone
      ? `Phone: ${contact.phone}`
      : "";
    document.getElementById("bizAddress").textContent = contact.address
      ? `Address: ${contact.address}`
      : "";
    document.getElementById("bizWebsite").textContent = contact.website
      ? `Website: ${contact.website}`
      : "No website found";
    document.getElementById("bizRating").textContent = biz.rating
      ? `Rating: ${biz.rating} (${biz.reviewCount || "?"} reviews)`
      : "";
  }

  function displayAnalysis(analysis) {
    const gapsSection = document.getElementById("gapsSection");
    const gapsList = document.getElementById("gapsList");
    const promptPreview = document.getElementById("promptPreview");

    if (analysis.gaps && analysis.gaps.length > 0) {
      gapsSection.style.display = "block";
      gapsList.innerHTML = analysis.gaps
        .map(
          (gap) => `
        <div class="gap-item">
          <div class="impact ${gap.impact}"></div>
          <div>
            <div class="gap-text">${escapeHtml(gap.gap)}</div>
            <div class="gap-explain">${escapeHtml(gap.explanation)}</div>
          </div>
        </div>
      `
        )
        .join("");
    }

    if (analysis.lovablePrompt) {
      promptPreview.style.display = "block";
      promptPreview.textContent = analysis.lovablePrompt;
    }
  }

  function setStatus(text, type) {
    scanStatus.textContent = text;
    scanStatus.className = `scan-status visible ${type}`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Leads ──

  async function loadLeads() {
    const leads = await sendMessage({ type: "GET_LEADS" });
    const container = document.getElementById("leadsList");

    if (!leads || leads.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">&#128269;</div>
          <p>No leads yet. Scan a business page to get started.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = leads
      .map(
        (lead) => `
      <div class="lead-item" data-id="${lead.id}">
        <div>
          <div class="lead-name">${escapeHtml(
            lead.businessName || lead.scrapedData?.business?.name || "Unknown"
          )}</div>
        </div>
        <span class="lead-status ${lead.status}">${lead.status}</span>
      </div>
    `
      )
      .join("");
  }

  async function updateLeadCount() {
    const leads = await sendMessage({ type: "GET_LEADS" });
    const count = leads?.length || 0;
    leadCountEl.textContent = count > 0 ? `(${count})` : "";
  }

  // ── Messaging ──

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
