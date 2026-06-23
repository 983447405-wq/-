document.getElementById("openWorkspace").addEventListener("click", () => {
  if (chrome.sidePanel?.open) {
    chrome.windows.getCurrent((window) => {
      chrome.sidePanel.open({ windowId: window.id });
    });
    window.close();
    return;
  }

  chrome.tabs.create({ url: chrome.runtime.getURL("workspace.html") });
  window.close();
});
