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

async function registerUser({ name, surname, institution, email, password }) {
  const existing = getUserByEmail(email);
  if (existing) {
    return { ok: false, error: "An account with this email already exists." };
  }

  const id = `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const passwordHash = await hashPassword(password);

  const displayName = [name, surname].filter(Boolean).map((x) => String(x).trim()).join(" ").trim();

  const db = loadUsersDb();
  db.users.push({
    id,
    name: displayName || (name ? String(name).trim() : ""),
    // Keep raw fields too (useful for future UI).
    firstName: name ? String(name).trim() : "",
    surname: surname ? String(surname).trim() : "",
    institution: institution ? String(institution).trim() : "",
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
  // Demo user credentials can be changed later via registration.
  await registerUser({
    name: "Saint Clement",
    surname: "Director",
    institution: "Demo Institution",
    email: DEMO_EMAIL,
    password: "demo1234",
  });
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

$("#signupLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = "./signup.html";
});

$("#forgotLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  setStatus("Password reset not implemented in static preview.");
});

// ===== Phase 2: Signup (new split register on index.html) =====
const registerForm = $("#registerForm");
const registerStatusEl = $("#registerStatus");

const regNameEl = $("#regName");
const regSurnameEl = $("#regSurname");
const regInstitutionEl = $("#regInstitution");
const regEmailEl = $("#regEmail");
const regPasswordEl = $("#regPassword");
const regConfirmPasswordEl = $("#regConfirmPassword");

function setRegisterStatus(msg) {
  if (registerStatusEl) registerStatusEl.textContent = msg;
}

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = regNameEl?.value?.trim() ?? "";
  const surname = regSurnameEl?.value?.trim() ?? "";
  const institution = regInstitutionEl?.value?.trim() ?? "";
  const email = regEmailEl?.value?.trim() ?? "";
  const password = regPasswordEl?.value ?? "";
  const confirmPassword = regConfirmPasswordEl?.value ?? "";

  if (!name) {
    setRegisterStatus("Please enter your name.");
    return;
  }
  if (!institution) {
    setRegisterStatus("Please enter your institution name.");
    return;
  }
  if (!email) {
    setRegisterStatus("Please enter your email.");
    return;
  }
  if (!password) {
    setRegisterStatus("Please enter your password.");
    return;
  }
  if (!confirmPassword) {
    setRegisterStatus("Please confirm your password.");
    return;
  }
  if (password !== confirmPassword) {
    setRegisterStatus("Passwords do not match. Please try again.");
    return;
  }

  setRegisterStatus("Creating account…");
  const res = await registerUser({ name, surname, institution, email, password });
  if (!res.ok) {
    setRegisterStatus(res.error || "Could not create account.");
    return;
  }

  // Automatically log in after successful registration.
  const user = getUserByEmail(email);
  setSession({ email: user?.email || email, name: user?.name || name });
  try {
    createLegacyLoginRecord(email);
  } catch {
    // ignore
  }

  setRegisterStatus("Account created. Redirecting to dashboard…");
  setTimeout(() => {
    window.location.href = "./dashboard.html";
  }, 500);
});

// ===== Phase 2b: Signup (legacy separate signup.html) =====
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
  // legacy signup.html does not collect surname/institution
  const res = await registerUser({ name, surname: "", institution: "", email, password });
  if (!res.ok) {
    setSignupStatus(res.error || "Could not create account.");
    return;
  }

  const user = getUserByEmail(email);
  setSession({ email, name: user?.name || name });
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

// ===== Phase 3b: Calendar preview injection (current month) =====
function renderCalendarPreview() {
  const calGridEl = document.getElementById("calGrid");
  if (!calGridEl) return;

  const now = new Date();
  const month = now.getMonth(); // 0-11
  const year = now.getFullYear();

  // We render a Mon-Fri grid to match the existing weekday labels.
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastOfMonth.getDate();

  // Map JS getDay() (Sun=0..Sat=6) to Mon=0..Fri=4.
  // Only Mon-Fri are shown.
  function colForDayIndex(jsDay) {
    // jsDay 1..5 => Mon..Fri
    if (jsDay >= 1 && jsDay <= 5) return jsDay - 1;
    return -1;
  }

  // Find offset from Monday for the first day shown.
  const firstJsDay = firstOfMonth.getDay();
  // We want column 0 for Monday. If first is Saturday/Sunday, it will start at end.
  const firstCol = colForDayIndex(firstJsDay);

  // Clear and build 5-column grid.
  calGridEl.innerHTML = "";
  calGridEl.style.display = "grid";
  calGridEl.style.gridTemplateColumns = "repeat(5, 1fr)";
  calGridEl.style.gap = "10px";

  // A simple heuristic for demo availability:
  // - weekends (not shown) => ignored
  // - lecture blocks: even dates
  // - booked: dates divisible by 3
  // - available: rest

  // Determine starting date for the first row that includes Mon.
  // We'll iterate day-by-day and only append Mon-Fri cells.
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    const jsDay = dt.getDay(); // Sun=0
    const col = colForDayIndex(jsDay);
    if (col === -1) continue;

    const isLecture = d % 2 === 0;
    const isBooked = d % 3 === 0;
    // Map to existing CSS dots: lecture -> booked (gold), blocked -> blocked, available -> available.
    let cls = "available";
    if (isBooked) cls = "booked";
    else if (isLecture) cls = "blocked";

    const cell = document.createElement("div");
    cell.className = `cal-cell ${cls}`;
    cell.setAttribute("role", "listitem");
    cell.setAttribute("aria-label", `${dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`);
    cell.textContent = String(d);

    calGridEl.appendChild(cell);
  }
}

// ===== Phase 3c: Marketplace/day boot =====



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

// ===== Interactive booking receipt (book.html only) =====
function moneyFromPriceText(priceText) {
  // "120" => 120 ; "R 120" => 120
  const n = Number(String(priceText || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function renderBookingReceipt(state) {
  const serviceName = state.service?.name || "";
  const servicePrice = state.service?.price != null ? `R ${state.service.price}` : "—";
  const stylistName = state.stylist?.name || "";
  const dateText = state.dateText || "Wed 14 May 2025";
  const timeRangeText = state.timeRangeText || "—";

  const sPreview = document.querySelector("[data-rc-service]");
  const stPreview = document.querySelector("[data-rc-stylist]");
  const dPreview = document.querySelector("[data-rc-date]");
  const tPreview = document.querySelector("[data-rc-time]");
  const pPreview = document.querySelector("[data-rc-price]");

  if (sPreview) sPreview.textContent = serviceName || "—";
  if (stPreview) stPreview.textContent = stylistName || "—";
  if (dPreview) dPreview.textContent = dateText;
  if (tPreview) tPreview.textContent = timeRangeText;
  if (pPreview) pPreview.textContent = servicePrice;

  const sConfirm = document.querySelector("[data-rc-confirm-service]");
  const stConfirm = document.querySelector("[data-rc-confirm-stylist]");
  const dConfirm = document.querySelector("[data-rc-confirm-date]");
  const tConfirm = document.querySelector("[data-rc-confirm-time]");
  const pConfirm = document.querySelector("[data-rc-confirm-price]");

  if (sConfirm) sConfirm.textContent = serviceName || "—";
  if (stConfirm) stConfirm.textContent = stylistName || "—";
  if (dConfirm) dConfirm.textContent = dateText;
  if (tConfirm) tConfirm.textContent = timeRangeText;
  if (pConfirm) pConfirm.textContent = servicePrice;

  const confirmBtn = document.getElementById("confirmReceiptBtn");
  const receiptToDashboard = document.getElementById("receiptToDashboard");
  const confirmStatus = document.querySelector("[data-confirm-status]");

  const isComplete = Boolean(state.service?.name && state.stylist?.name && state.time?.start);

  if (confirmBtn) {
    confirmBtn.disabled = !isComplete || Boolean(state.locked);
  }

  if (confirmStatus) {
    if (!isComplete) {
      confirmStatus.textContent = "Select a service, a stylist and a time to enable confirmation.";
    } else if (state.locked) {
      confirmStatus.textContent = "Receipt confirmed. You can proceed to the dashboard.";
    } else {
      confirmStatus.textContent = "Ready. Confirm once selections are adjusted.";
    }
  }

  if (receiptToDashboard) {
    const canGo = Boolean(state.locked);
    receiptToDashboard.setAttribute("aria-disabled", canGo ? "false" : "true");
    receiptToDashboard.style.pointerEvents = canGo ? "auto" : "none";
    receiptToDashboard.style.opacity = canGo ? "1" : "0.65";
  }
}

function bootBookingReceipt() {
  // In this prototype, book.html doesn’t have a root id. So we detect via receipt elements.
  const hasReceipt = document.querySelector(".receipt");
  if (!hasReceipt) return;


  const state = {
    service: null,
    stylist: null,
    time: null,
    locked: false,
    dateText: "Wed 14 May 2025",
    // For display; selection currently maps to a 1-hour appointment.
    get timeRangeText() {
      if (!this.time?.start) return "—";
      const [hh, mm] = String(this.time.start).split(":").map((x) => Number(x));
      const end = new Date(2000, 0, 1, hh, mm);
      end.setHours(end.getHours() + 1);
      const endText = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
      return `${this.time.start} — ${endText}`;
    },
  };

  // Default selected items from the pre-rendered .selected classes.
  const selectedServiceEl = document.querySelector(".choice[data-service].selected");
  const selectedStylistEl = document.querySelector(".choice[data-stylist].selected");
  const selectedTimeEl = document.querySelector(".time[data-time]:not(.blocked):not([disabled])");

  if (selectedServiceEl) {
    const price = moneyFromPriceText(selectedServiceEl.getAttribute("data-price"));
    state.service = { name: selectedServiceEl.getAttribute("data-service"), price };
  }
  if (selectedStylistEl) {
    state.stylist = { name: selectedStylistEl.getAttribute("data-stylist") };
  }

  // There is no selected time by default, but book.html summary shows 14:00 — 15:00.
  // Use that as the initial time selection if present.
  const defaultTimeBtn = document.querySelector(".time[data-time='14:00']");
  if (defaultTimeBtn && !defaultTimeBtn.disabled && !defaultTimeBtn.classList.contains("blocked")) {
    state.time = { start: "14:00" };
  }

  function setTab(tabName) {
    const tabBtns = document.querySelectorAll(".tab[data-tab]");
    const panels = document.querySelectorAll(".receipt-panel[data-panel]");

    tabBtns.forEach((b) => {
      const isActive = b.getAttribute("data-tab") === tabName;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((p) => {
      const isActive = p.getAttribute("data-panel") === tabName;
      p.hidden = !isActive;
    });
  }

  function syncFromUI() {
    // Update state.service
    const serviceSelected = document.querySelector(".choice[data-service].selected");
    const stylistSelected = document.querySelector(".choice[data-stylist].selected");
    state.service = serviceSelected
      ? {
          name: serviceSelected.getAttribute("data-service"),
          price: moneyFromPriceText(serviceSelected.getAttribute("data-price")),
        }
      : null;

    state.stylist = stylistSelected
      ? {
          name: stylistSelected.getAttribute("data-stylist"),
        }
      : null;

    // Update state.time from the currently clicked selected time (we mark via selected class)
    const timeSelected = document.querySelector(".time[data-time].selected");
    state.time = timeSelected
      ? {
          start: timeSelected.getAttribute("data-time"),
        }
      : null;

    // Recompute display
    renderBookingReceipt({
      ...state,
      timeRangeText: state.timeRangeText,
    });

    // Keep confirm tab consistent with lock state.
    if (state.locked) return;
    const confirmTabBtn = document.querySelector(".tab[data-tab='confirm']");
    if (confirmTabBtn && confirmTabBtn.classList.contains("active")) {
      // If user is on confirm tab and not complete, switch back to preview.
      const isComplete = Boolean(state.service?.name && state.stylist?.name && state.time?.start);
      if (!isComplete) setTab("preview");
    }
  }

  // Make time buttons selectable visually.
  document.querySelectorAll(".choice[data-service]").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".choice[data-service]").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      syncFromUI();
      setTab("preview");
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });
  });

  document.querySelectorAll(".choice[data-stylist]").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".choice[data-stylist]").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      syncFromUI();
      setTab("preview");
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });
  });

  document.querySelectorAll(".time[data-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled || btn.classList.contains("blocked")) return;
      document.querySelectorAll(".time[data-time]").forEach((x) => x.classList.remove("selected"));
      btn.classList.add("selected");
      syncFromUI();
      setTab("preview");
    });
  });

  document.querySelectorAll(".tab[data-tab]").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      const tabName = tabBtn.getAttribute("data-tab");
      if (tabName === "confirm") {
        const isComplete = Boolean(state.service?.name && state.stylist?.name && state.time?.start);
        if (!isComplete) {
          setTab("preview");
          return;
        }
      }
      setTab(tabName);
    });
  });

  const confirmBtn = document.getElementById("confirmReceiptBtn");
  const receiptToDashboard = document.getElementById("receiptToDashboard");

  confirmBtn?.addEventListener("click", () => {
    const isComplete = Boolean(state.service?.name && state.stylist?.name && state.time?.start);
    if (!isComplete || state.locked) return;

    state.locked = true;

    // Persist receipt (demo)
    try {
      localStorage.setItem(
        "groomhub_booking_last",
        JSON.stringify({
          service: state.service,
          stylist: state.stylist,
          time: state.time,
          dateText: state.dateText,
          confirmedAt: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }

    // Update button + allow navigation.
    confirmBtn.textContent = "Receipt Confirmed";
    confirmBtn.disabled = true;
    if (receiptToDashboard) {
      receiptToDashboard.setAttribute("aria-disabled", "false");
      receiptToDashboard.style.pointerEvents = "auto";
      receiptToDashboard.style.opacity = "1";
    }

    // Show confirm panel values as locked.
    renderBookingReceipt({
      ...state,
      timeRangeText: state.timeRangeText,
    });
  });

  // Apply initial selected time button and render initial receipt.
  if (defaultTimeBtn) {
    document.querySelectorAll(".time[data-time]").forEach((x) => x.classList.remove("selected"));
    defaultTimeBtn.classList.add("selected");
    state.time = { start: "14:00" };
  }

  renderBookingReceipt({
    ...state,
    timeRangeText: state.timeRangeText,
  });
}

if (typeof document !== "undefined") {
  bootBookingReceipt();
}

// Boot marketplace on their pages
if (typeof document !== "undefined") {
  if (document.getElementById("marketGrid")) {
    renderMarketplace();
  }
}











