const $ = (sel) => document.querySelector(sel);

const form = $("#loginForm");
const statusEl = $("#status");
const yearEl = $("#year");
yearEl.textContent = new Date().getFullYear();

function setStatus(msg) {
  statusEl.textContent = msg;
}

function fakeLogin(email) {
  // Local-only demo. Replace with real API later.
  const payload = {
    email,
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem("groomhub.static.login.v1", JSON.stringify(payload));
  } catch {
    // ignore
  }
}

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("#email")?.value?.trim() ?? "";
  const password = $("#password")?.value ?? "";

  if (!email) return setStatus("Please enter your email.");
  if (!password) return setStatus("Please enter your password.");

  fakeLogin(email);
  setStatus("Logged in (static demo). Redirecting…");

  // No backend: just simulate navigation.
  setTimeout(() => {
    // If you deploy later, swap this to your real app route.
    window.location.href = "./index.html";
  }, 800);
});

$("#demoLogin")?.addEventListener("click", (e) => {
  e.preventDefault();
  fakeLogin("demo@students.edu");
  setStatus("Demo mode enabled. (static preview) ");
});

$("#signupLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  setStatus("Signup not implemented in static preview. Wire to /signup when runtime is available.");
});

$("#forgotLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  setStatus("Password reset not implemented in static preview.");
});

