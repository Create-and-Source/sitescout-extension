// ============================================================
// SiteScout — Options Page
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const claudeKeyInput = document.getElementById("claudeKey");
  const crmUrlInput = document.getElementById("crmUrl");
  const apiKeyInput = document.getElementById("apiKey");
  const lovableEmailInput = document.getElementById("lovableEmail");
  const saveBtn = document.getElementById("saveBtn");
  const savedMsg = document.getElementById("savedMsg");

  // Load saved settings
  chrome.storage.sync.get(
    ["claudeApiKey", "crmApiUrl", "apiKey", "lovableEmail"],
    (result) => {
      claudeKeyInput.value = result.claudeApiKey || "";
      crmUrlInput.value = result.crmApiUrl || "";
      apiKeyInput.value = result.apiKey || "";
      lovableEmailInput.value = result.lovableEmail || "";
    }
  );

  // Save settings
  saveBtn.addEventListener("click", () => {
    chrome.storage.sync.set(
      {
        claudeApiKey: claudeKeyInput.value.trim(),
        crmApiUrl: crmUrlInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        lovableEmail: lovableEmailInput.value.trim(),
      },
      () => {
        savedMsg.classList.add("visible");
        setTimeout(() => savedMsg.classList.remove("visible"), 2000);
      }
    );
  });
});
