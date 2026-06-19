// Service worker (MV3). The ONLY component with `cookies` permission: it reads
// the HttpOnly LinkedIn `li_at` session cookie and returns it to the content
// script (which relays it to the 10xConnect app origin — and nowhere else).
//
// Messages arrive via chrome.runtime.onMessage, reachable only from this
// extension's own content/popup scripts (not arbitrary web pages), and the
// content script is injected solely on the 10xConnect app origin.

const LINKEDIN_URL = "https://www.linkedin.com";

/** Read the LinkedIn li_at session cookie. Resolves to { ok, liAt } | { ok:false, code }. */
function readLinkedInSession() {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: LINKEDIN_URL, name: "li_at" }, (cookie) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          code: "capture_failed",
          message: "Couldn't read your LinkedIn cookies. Reload the extension and try again.",
        });
        return;
      }
      if (!cookie || !cookie.value) {
        resolve({
          ok: false,
          code: "not_logged_in",
          message: "You're not signed in to LinkedIn in this browser. Sign in, then reconnect.",
        });
        return;
      }
      resolve({ ok: true, liAt: cookie.value });
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "capture-linkedin") {
    readLinkedInSession().then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message && message.type === "linkedin-status") {
    readLinkedInSession().then((res) => sendResponse({ loggedIn: res.ok === true }));
    return true;
  }
  return false;
});
