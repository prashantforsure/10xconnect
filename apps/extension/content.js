// Content script, injected ONLY on the 10xConnect app origin (see manifest
// content_scripts.matches). It bridges the web page <-> the service worker:
//
//   page  --window.postMessage({ source: "10xconnect-app", ... })-->  content
//   content --chrome.runtime.sendMessage-->  background (reads li_at cookie)
//   content  --window.postMessage({ source: "10xconnect-ext", ... })-->  page
//
// Correlated by `nonce`. The captured li_at is posted back only to this page's
// own origin, so it never leaves the trusted app surface.

const APP_SOURCE = "10xconnect-app";
const EXT_SOURCE = "10xconnect-ext";

function reply(payload) {
  window.postMessage({ source: EXT_SOURCE, ...payload }, window.location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  if (!data || data.source !== APP_SOURCE || typeof data.nonce !== "string") {
    return;
  }
  const nonce = data.nonce;

  if (data.type === "ping") {
    reply({ type: "pong", nonce, ok: true });
    return;
  }

  if (data.type === "capture-linkedin") {
    chrome.runtime.sendMessage({ type: "capture-linkedin" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        reply({
          type: "linkedin-session",
          nonce,
          ok: false,
          code: "capture_failed",
          message: "The extension couldn't capture your session. Reload it and try again.",
        });
        return;
      }
      reply({
        type: "linkedin-session",
        nonce,
        ok: res.ok === true,
        liAt: res.liAt,
        code: res.code,
        message: res.message,
      });
    });
  }
});

// Announce presence so the app can show "extension installed" without a probe.
reply({ type: "ready", nonce: "ready", ok: true });
