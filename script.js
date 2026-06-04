const $ = (sel) => document.querySelector(sel);

const form = $("#loginForm");
const statusEl = $("#status");
const yearEl = $("#year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}


const SESSION_KEY = "groomhub_v2_session";

// ===== Auth (Phase 1) — registration-first using localStorage as "built-in database" =====
const USERS_KEY = "groomhub_v2_users";
const LEGACY_LOGIN_KEY = "groomhub.static.login.v1";
const DEMO_EMAIL = "demo@students.edu";

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadUsersDb() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = safeJsonParse(raw, { users: [] });
    return {
      users: Array.isArray(parsed?.users) ? parsed.users : [],
    };
  } catch {
    return { users: [] };
  }
}

function saveUsersDb(db) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

async function hashPassword(plain) {
  const input = String(plain ?? "");

  // Prefer real hashing with WebCrypto.
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    const enc = new TextEncoder();
    const bytes = enc.encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Fallback (still functional, but not cryptographically strong).
  return input;
}

function getUserByEmail(email) {
  const db = loadUsersDb();
  return db.users.find((u) => String(u.email || "").toLowerCase() === String(email || "").toLowerCase()) || null;
}

async function registerUser({ name, email, password }) {
  const existing = getUserByEmail(email);
  if (existing) {
    return { ok: false, error: "An account with this email already exists." };
  }

  const id = `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const passwordHash = await hashPassword(password);

  const db = loadUsersDb();
  db.users.push({
    id,
    name: name ? String(name).trim() : "",
    email: String(email).trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  });
  saveUsersDb(db);

  return { ok: true };
}

async function verifyLogin({ email, password }) {
  const user = getUserByEmail(email);
  if (!user) return { ok: false, error: "No account found for this email. Please create one." };

  const passwordHash = await hashPassword(password);
  if (String(user.passwordHash) !== String(passwordHash)) {
    return { ok: false, error: "Incorrect password." };
  }

  return { ok: true, user };
}

function createLegacyLoginRecord(email) {
  const payload = {
    email,
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LEGACY_LOGIN_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

async function ensureDemoUser() {
  const demo = getUserByEmail(DEMO_EMAIL);
  if (demo) return;
  // Demo password can be "demo1234"; user can change later by registering.
  await registerUser({ name: "Demo Student", email: DEMO_EMAIL, password: "demo1234" });
}

function requireAuthOrRedirect() {
  // Allow login/signup pages.
  const path = (window.location.pathname || "").toLowerCase();
  const isLoginPage = path.endsWith("index.html") || path.endsWith("/index.html");
  const isSignupPage = path.endsWith("signup.html") || path.endsWith("/signup.html");
  if (isLoginPage || isSignupPage) return;

  const ok = isLoggedIn();
  if (!ok) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("auth", "required");
      window.location.href = `./index.html?auth=required`;
    } catch {
      window.location.href = "./index.html?auth=required";
    }
  }
}



function isLoggedIn() {
  try {
    return Boolean(window.localStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
}

function getSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applySessionToHeader() {
  // Clear any demo popups if navigating between pages.
  const popupEl = document.getElementById("demoReminderPopup");
  if (popupEl) popupEl.remove();
  const session = getSession();
  const user = session?.user;
  if (!user) return;

  // Update the “Current User” block on protected pages.
  const nameEl = document.getElementById("currentUserName");
  const roleEl = document.getElementById("currentUserRole");
  const avatarEl = document.getElementById("currentUserAvatar");

  if (nameEl) nameEl.textContent = user.name || user.email || "Student";
  if (roleEl) roleEl.textContent = "Online";

  if (avatarEl) {
    const initial = String(user.name || user.email || "U")
      .trim()
      .charAt(0)
      .toUpperCase();
    avatarEl.textContent = initial;
  }

  // Paper-trail UX requested: show online status under the logo on pages
  // that include a placeholder.
  const onlineEl = document.getElementById("onlineBadge");
  if (onlineEl) onlineEl.textContent = "Logged in online";
}


function setSession(user) {
  try {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ user: user || null, createdAt: new Date().toISOString() })
    );
  } catch {
    // ignore
  }
}

function getUserFromForm(email) {
  // keep it simple: only store email; personalization can be added later
  return { email };
}

async function doLogin({ email, password }) {
  if (!email) return { ok: false, error: "Please enter your email." };
  if (!password) return { ok: false, error: "Please enter your password." };

  const res = await verifyLogin({ email, password });
  if (!res.ok) return res;

  // keep legacy key for any existing code, but use groomhub-v2-like session for new logic.
  createLegacyLoginRecord(email);
  setSession({ email: res.user.email, name: res.user.name || "" });
  return { ok: true };
}

// Phase 1 login: land on dashboard only if credentials match an existing registered account.
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email")?.value?.trim() ?? "";
  const password = $("#password")?.value ?? "";

  const { ok, error } = await doLogin({ email, password });
  if (!ok) {
    setStatus(error || "Login failed. Please try again.");
    return;
  }

  setStatus("Logged in. Redirecting to dashboard…");
  setTimeout(() => {
    window.location.href = "./dashboard.html";
  }, 500);
});


$("#demoLogin")?.addEventListener("click", async (e) => {
  e.preventDefault();
  await ensureDemoUser();
  // Demo password is fixed; the demo user can also be created via signup page.
  const { ok } = await doLogin({ email: DEMO_EMAIL, password: "demo1234" });
  if (!ok) {
    setStatus("Demo login failed. Please use Create account.");
    return;
  }

  setStatus("Demo mode enabled. Redirecting to dashboard…");
  setTimeout(() => {
    window.location.href = "./dashboard.html";
  }, 400);
});


function showSignupPanel() {
  const loginPanel = document.getElementById("loginPanel");
  const signupPanel = document.getElementById("signupPanel");
  if (loginPanel) loginPanel.style.display = "none";
  if (signupPanel) signupPanel.style.display = "block";
}

function showLoginPanel() {
  const loginPanel = document.getElementById("loginPanel");
  const signupPanel = document.getElementById("signupPanel");
  if (signupPanel) signupPanel.style.display = "none";
  if (loginPanel) loginPanel.style.display = "block";
}

$("#signupLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  showSignupPanel();
});

$("#backToLogin")?.addEventListener("click", (e) => {
  e.preventDefault();
  showLoginPanel();
});



$("#forgotLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  setStatus("Password reset not implemented in static preview.");
});

// ===== Phase 2: Signup (localStorage) =====
const signupForm = $("#signupForm");
const signupEmailEl = $("#signupEmail");
const signupPasswordEl = $("#signupPassword");
const confirmPasswordEl = $("#confirmPassword");
const signupNameEl = $("#name");
const signupStatusEl = $("#signupStatus");

function setSignupStatus(msg) {
  if (signupStatusEl) signupStatusEl.textContent = msg;
}

signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = signupNameEl?.value?.trim() ?? "";
  const email = signupEmailEl?.value?.trim() ?? "";
  const password = signupPasswordEl?.value ?? "";
  const confirmPassword = confirmPasswordEl?.value ?? "";

  if (!email) {
    setSignupStatus("Please enter your email.");
    return;
  }
  if (!password) {
    setSignupStatus("Please enter your password.");
    return;
  }
  if (!confirmPassword) {
    setSignupStatus("Please confirm your password.");
    return;
  }
  if (password !== confirmPassword) {
    setSignupStatus("Passwords do not match. Please try again.");
    return;
  }

  setSignupStatus("Creating account…");
  const res = await registerUser({ name, email, password });
  if (!res.ok) {
    setSignupStatus(res.error || "Could not create account.");
    return;
  }

  // Automatically log in after successful registration.
  setSession({ email, name });
  try {
    createLegacyLoginRecord(email);
  } catch {
    // ignore
  }

  setSignupStatus("Account created. Redirecting to dashboard…");
  setTimeout(() => {
    window.location.href = "./dashboard.html";
  }, 500);
});

// ===== Phase 3: Marketplace logic-only (localStorage) =====
const MARKET_SESSION_KEY = "groomhub_v2_marketplace";


const marketplaceData = {
  products: [
    { id: "m1", name: "Precision Grooming Kit", desc: "Includes brush, comb + travel-friendly essentials.", price: "R 39.00", category: "Accessories" },
    { id: "m2", name: "Hydrating Beard Oil", desc: "Soothes skin + adds natural shine.", price: "R 18.00", category: "Beard Care" },
    { id: "m3", name: "Satin Hair Pomade", desc: "Flexible hold with a non-greasy finish.", price: "R 22.50", category: "Hair Styling" },
    { id: "m4", name: "Clean Cut Mustache Wax", desc: "Strong hold for a sharp, tidy mustache.", price: "R 14.90", category: "Beard Care" },
    { id: "m5", name: "Shine Shield Hair Serum", desc: "Reduces frizz + boosts healthy-looking shine.", price: "R 29.00", category: "Hair Care" },
    { id: "m6", name: "Gentle Face & Neck Wash", desc: "Light cleanse for skin that feels refreshed.", price: "R 24.50", category: "Skin Care" },
    { id: "m7", name: "Soft Bristle Beard Brush", desc: "Detangles + distributes oils evenly.", price: "R 16.00", category: "Accessories" },
    { id: "m8", name: "Cool Breeze Aftershave Balm", desc: "Soothes after shaving with a smooth finish.", price: "R 21.75", category: "Skin Care" },
  ],
};

function readMarketState() {
  try {
    const raw = localStorage.getItem(MARKET_SESSION_KEY);
    if (!raw) return { cart: [], activity: [] };
    const parsed = JSON.parse(raw);
    return {
      cart: Array.isArray(parsed.cart) ? parsed.cart : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    };
  } catch {
    return { cart: [], activity: [] };
  }
}

function writeMarketState(next) {
  try {
    localStorage.setItem(MARKET_SESSION_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function getCartCount(cart) {
  return cart.reduce((sum, line) => sum + (line.qty || 0), 0);
}

function upsertCartItem(productId, name, price) {
  const state = readMarketState();
  const cart = state.cart;
  const idx = cart.findIndex((x) => x.productId === productId);
  if (idx >= 0) {
    cart[idx].qty = (cart[idx].qty || 0) + 1;
  } else {
    cart.push({ productId, name, price, qty: 1 });
  }
  state.cart = cart;
  writeMarketState(state);
}

function removeCartItem(productId) {
  const state = readMarketState();
  state.cart = state.cart.filter((x) => x.productId !== productId);
  writeMarketState(state);
}

function pushActivity(kind, payload) {
  const state = readMarketState();
  state.activity.unshift({
    id: `a_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    kind,
    payload,
    at: new Date().toISOString(),
  });
  state.activity = state.activity.slice(0, 8);
  writeMarketState(state);
}

function moneyToNumber(price) {
  // price like "R 18.00" -> 18.00
  const n = Number(String(price || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + moneyToNumber(line.price) * (line.qty || 0), 0);
}

function renderMarketplace() {
  const categoryEl = document.getElementById("marketCategory");
  const gridEl = document.getElementById("marketGrid");
  const statusEl = document.getElementById("marketStatus");

  if (statusEl) statusEl.textContent = "booted: renderMarketplace()";

  if (!categoryEl || !gridEl) {
    if (statusEl) statusEl.textContent = "error: missing marketCategory/marketGrid";
    return;
  }

  const categories = [
    "All",
    ...Array.from(new Set(marketplaceData.products.map((p) => p.category).filter(Boolean))),
  ];

  // populate dropdown
  categories.forEach((c) => {
    if (categoryEl.querySelector(`option[value="${CSS.escape(c)}"]`)) return;
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categoryEl.appendChild(opt);
  });

  const state = readMarketState();
  const cartCount = getCartCount(state.cart);
  const cartCountEl = document.getElementById("cartCount");
  if (cartCountEl) cartCountEl.textContent = `${Math.min(100, cartCount * 10)}%`;

  function filteredProducts() {
    const cat = categoryEl.value || "All";
    if (cat === "All") return marketplaceData.products;
    return marketplaceData.products.filter((p) => p.category === cat);
  }

  function renderGrid() {
    const items = filteredProducts();
    gridEl.innerHTML = "";

    items.forEach((it) => {
      const card = document.createElement("div");
      card.className = "panel";
      card.style.padding = "16px";
      card.style.background = "rgba(12,12,14,.25)";

      card.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-start; justify-content:space-between;">
          <div>
            <div style="font-weight:950; font-size:18px;">${it.name}</div>
            <div style="margin-top:8px; opacity:.92; line-height:1.45; font-size:13px;">${it.desc}</div>
          </div>
          <div style="text-align:right; min-width:90px;">
            <div style="font-weight:950; color: var(--text-h);">${it.price}</div>
          </div>
        </div>
        <div style="display:flex; gap:10px; margin-top:12px;">
          <button type="button" class="btn secondary" style="width:auto; padding:10px 14px;" data-action="add" data-id="${it.id}">Add</button>
        </div>
      `;

      gridEl.appendChild(card);
    });

    if (statusEl) statusEl.textContent = `${filteredProducts().length} item(s)`;
  }

  function renderCartAndActivity() {
    const cartListEl = document.getElementById("cartList");
    const activityListEl = document.getElementById("activityList");
    const cartEmptyEl = document.getElementById("cartEmpty");

    if (!cartListEl || !activityListEl) return;

    const state2 = readMarketState();
    const cart = state2.cart;

    cartListEl.innerHTML = "";
    if (cartEmptyEl) cartEmptyEl.style.display = cart.length ? "none" : "block";

    cart.forEach((line) => {
      const row = document.createElement("div");
      row.className = "history-item";
      row.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div style="font-weight:950;">${line.name}</div>
          <div class="muted" style="font-size:12px;">${line.price} × ${line.qty}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px; align-items:flex-end;">
          <div style="font-weight:950;">R ${moneyToNumber(line.price) * (line.qty || 0)}</div>
          <button type="button" class="btn ghost" style="width:auto; padding:10px 12px;" data-action="remove" data-id="${line.productId}">Remove</button>
        </div>
      `;
      cartListEl.appendChild(row);
    });

    activityListEl.innerHTML = "";
    state2.activity.forEach((a) => {
      const row = document.createElement("div");
      row.className = "history-item";
      row.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div style="font-weight:950;">${a.kind}</div>
          <div class="muted" style="font-size:12px;">${new Date(a.at).toLocaleString()}</div>
        </div>
        <div style="font-weight:900; color: var(--text-h);">${a.payload?.summary || "—"}</div>
      `;
      activityListEl.appendChild(row);
    });
  }

  function renderCartCount() {
    const state3 = readMarketState();
    const cartCount = getCartCount(state3.cart);
    const cartCountEl = document.getElementById("cartCount");
    if (cartCountEl) cartCountEl.textContent = `${Math.min(100, cartCount * 10)}%`;
  }

  // initial
  renderGrid();
  renderCartAndActivity();
  renderCartCount();

  categoryEl.addEventListener("change", () => {
    renderGrid();
  });

  gridEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='add']");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const prod = marketplaceData.products.find((p) => p.id === id);
    if (!prod) return;

    upsertCartItem(prod.id, prod.name, prod.price);
    pushActivity("Added to cart", { summary: prod.name });
    renderCartAndActivity();
    renderCartCount();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='remove']");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const prod = marketplaceData.products.find((p) => p.id === id);
    removeCartItem(id);
    pushActivity("Removed from cart", { summary: prod?.name || "Item" });
    renderCartAndActivity();
    renderCartCount();
  });

  const viewCartBtn = document.getElementById("viewCartBtn");
  if (viewCartBtn) {
    viewCartBtn.addEventListener("click", () => {
      const section = document.querySelector("#cartList");
      section?.scrollIntoView({ behavior: "smooth", block: "center" });
      pushActivity("Viewed cart", { summary: "Cart" });
      renderCartAndActivity();
    });
  }

  const checkoutBtn = document.getElementById("checkoutBtn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      const state4 = readMarketState();
      const total = cartTotal(state4.cart);
      if (!state4.cart.length) {
        setStatus?.("Cart is empty. Add items first.");
        pushActivity("Checkout blocked", { summary: "Cart empty" });
        renderCartAndActivity();
        return;
      }

      // demo checkout: clear cart
      state4.cart = [];
      writeMarketState(state4);
      pushActivity("Checkout complete (demo)", { summary: `Total: R ${total}` });
      renderCartAndActivity();
      renderCartCount();
    });
  }
}

// Always enforce auth gating on protected pages.
if (typeof document !== "undefined") {
  requireAuthOrRedirect();
  applySessionToHeader();
}

// ===== Booking flow (book.html) =====
(function initBookingFlow() {
  const serviceGrid = document.getElementById("serviceGrid");
  const stylistGrid = document.getElementById("stylistGrid");
  const timeGrid = document.getElementById("timeGrid");
  const confirmBtn = document.getElementById("confirmBookingBtn");

  if (!serviceGrid || !stylistGrid || !timeGrid || !confirmBtn) return;

  const summaryService = document.getElementById("summaryService");
  const summaryStylist = document.getElementById("summaryStylist");
  const summaryTime = document.getElementById("summaryTime");
  const summaryDate = document.getElementById("summaryDate");
  const bookingTinyMuted = document.getElementById("bookingTinyMuted");

  const state = {
    serviceId: null,
    serviceName: null,
    stylistId: null,
    stylistName: null,
    timeId: null,
    timeLabel: null,
    // simple demo range for summary
    dateLabel: summaryDate?.textContent || "Wed 14 May 2025",
  };

  function setMuted(msg) {
    if (bookingTinyMuted) bookingTinyMuted.textContent = msg;
  }

  function setSummary() {
    if (summaryService) summaryService.textContent = state.serviceName || "—";
    if (summaryStylist) summaryStylist.textContent = state.stylistName || "—";
    if (summaryDate) summaryDate.textContent = state.dateLabel;
    if (summaryTime) {
      if (!state.timeLabel) {
        summaryTime.textContent = "—";
      } else {
        // match the static labels like “14:00 — 15:00”
        summaryTime.textContent = `${state.timeLabel} — 15:00`;
      }
    }
  }

  function clearSelected(grid) {
    grid.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
  }

  function selectChoice(el, grid, which) {
    clearSelected(grid);
    el.classList.add("selected");

    if (which === "service") {
      state.serviceId = el.getAttribute("data-service-id");
      state.serviceName = el.getAttribute("data-service-name");
      setMuted("Now choose a stylist and a valid time.");
    }

    if (which === "stylist") {
      state.stylistId = el.getAttribute("data-stylist-id");
      state.stylistName = el.getAttribute("data-stylist-name");
      setMuted("Now choose a time.");
    }

    if (which === "time") {
      state.timeId = el.getAttribute("data-time-id");
      state.timeLabel = el.getAttribute("data-time-label");
      setMuted("Ready. Confirm your booking.");
    }

    setSummary();
  }

  // Initialize from default selected items (if any)
  const initialService = serviceGrid.querySelector(".choice.selected");
  if (initialService) selectChoice(initialService, serviceGrid, "service");

  const initialStylist = stylistGrid.querySelector(".choice.selected");
  if (initialStylist) selectChoice(initialStylist, stylistGrid, "stylist");

  const initialTime = timeGrid.querySelector("button.time:not(.blocked):not([disabled]).selected");
  if (initialTime) {
    selectChoice(initialTime, timeGrid, "time");
  } else {
    // If no initial time, keep summaryTime as static defaults (14:00 — 15:00 is in markup)
    // but still update once user interacts.
  }

  serviceGrid.addEventListener("click", (e) => {
    const el = e.target.closest(".choice[role='button']");
    if (!el) return;
    selectChoice(el, serviceGrid, "service");
  });

  stylistGrid.addEventListener("click", (e) => {
    const el = e.target.closest(".choice[role='button']");
    if (!el) return;
    selectChoice(el, stylistGrid, "stylist");
  });

  timeGrid.addEventListener("click", (e) => {
    const el = e.target.closest("button.time");
    if (!el) return;
    if (el.disabled || el.classList.contains("blocked")) return;

    clearSelected(timeGrid);
    el.classList.add("selected");
    selectChoice(el, timeGrid, "time");
  });

  // Keyboard support for choice divs
  function handleChoiceKey(e, grid, which) {
    const key = e.key;
    if (key !== "Enter" && key !== " ") return;
    e.preventDefault();
    const el = e.target.closest(".choice[role='button']");
    if (!el) return;
    selectChoice(el, grid, which);
  }

  serviceGrid.addEventListener("keydown", (e) => handleChoiceKey(e, serviceGrid, "service"));
  stylistGrid.addEventListener("keydown", (e) => handleChoiceKey(e, stylistGrid, "stylist"));

  // Confirm booking
  confirmBtn.addEventListener("click", () => {
    if (!state.serviceId || !state.stylistId || !state.timeId) {
      setMuted("Select a service, stylist and a valid time.");
      return;
    }

    const payload = {
      id: `b_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      user: getSession()?.user || null,
      serviceId: state.serviceId,
      serviceName: state.serviceName,
      stylistId: state.stylistId,
      stylistName: state.stylistName,
      dateLabel: state.dateLabel,
      timeId: state.timeId,
      timeLabel: state.timeLabel,
      status: "confirmed",
    };

    const BOOKINGS_KEY = "groomhub_v2_bookings";
    const existingRaw = localStorage.getItem(BOOKINGS_KEY);
    const existing = existingRaw ? safeJsonParse(existingRaw, { bookings: [] }) : { bookings: [] };
    const bookings = Array.isArray(existing?.bookings) ? existing.bookings : [];

    bookings.unshift(payload);
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify({ bookings: bookings.slice(0, 20) }));

    // Navigate
    window.location.href = "./dashboard.html";
  });

  // Prime selected time button style (optional UX)
  // If user clicks around, we update summary already.
  setSummary();
})();

// Boot marketplace on its page
if (typeof document !== "undefined") {
  if (document.getElementById("marketGrid")) {
    renderMarketplace();
  }
}







