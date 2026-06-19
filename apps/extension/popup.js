// Popup: shows whether the user is currently signed in to LinkedIn so they know
// the extension can capture a session. No secrets are displayed.

const dot = document.getElementById("dot");
const status = document.getElementById("status");

chrome.runtime.sendMessage({ type: "linkedin-status" }, (res) => {
  if (chrome.runtime.lastError || !res) {
    dot.className = "dot bad";
    status.textContent = "Extension error — reload it";
    return;
  }
  if (res.loggedIn) {
    dot.className = "dot ok";
    status.textContent = "Signed in to LinkedIn — ready to connect";
  } else {
    dot.className = "dot bad";
    status.textContent = "Not signed in to LinkedIn";
  }
});
