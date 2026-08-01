// ============================================================
// WellRead Co. — common.js
// Shared foundation for all pages
// ============================================================

// ─── Firebase Config ────────────────────────────────────────
// Replace these values with your Firebase project credentials
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC9il8nGf3pz6Z6UqXnoKWFW3h2fBrUU5M",
  authDomain:        "wellread-co.firebaseapp.com",
  projectId:         "wellread-co",
  storageBucket:     "wellread-co.firebasestorage.app",
  messagingSenderId: "114566291288",
  appId:             "1:114566291288:web:d915eef5e65d1661e74f2d"
};

// ─── App Constants ───────────────────────────────────────────
const APP_NAME = "WellRead Co.";
const APP_VERSION = "1.0.0";
const ADMIN_UIDS = ["lxXxOVUQ8IVzBop4n1eqDHal6Gy2"];

// Pages that do not require authentication
const PUBLIC_PAGES = [
  "login.html",
  "reset.html",
  "setup.html",
  "wishlist-public.html"
];

// Pages that require admin access
const ADMIN_PAGES = ["admin.html"];

// ─── Cloudflare Worker URL ───────────────────────────────────
const WORKER_URL = "https://wellread-worker.matt-zmud.workers.dev";

// ─── Color Palette (CSS vars reference) ─────────────────────
// All colors are defined in each page's <style> block via CSS
// variables. This object is for any JS-driven color needs.
const COLORS = {
  lavenderMist:  "#F7F3FF",
  agedPaper:     "#FAF6EE",
  deepPlum:      "#2D1B4E",
  amethyst:      "#7B5EA7",
  fadedMoss:     "#9DC4B0",
  warmGold:      "#C9A84C",
  terracotta:    "#A0674A",
  border:        "#E8DFC8"
};

// ─── Globals ─────────────────────────────────────────────────
let _app = null;
let _auth = null;
let _db = null;
let _currentUser = null;
let _notifUnsubscribe = null;
let _unreadCount = 0;

// ─── Firebase Init ───────────────────────────────────────────
function initFirebase() {
  if (_app) return;
  _app  = firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  _db   = firebase.firestore();

  // Disable auto-detect then force long-polling to fix Safari WebChannel drops.
  // These two settings cannot be used together, so we must set both explicitly.
  _db.settings({
    experimentalAutoDetectLongPolling: false,
    experimentalForceLongPolling:      true,
    merge:                             true
  });
}

// ─── Auth State ──────────────────────────────────────────────
// Call this on every authenticated page.
// onReady(user) fires once auth is confirmed.
// Pages in PUBLIC_PAGES skip the auth check.
function initAuth(onReady) {
  initFirebase();

  const page     = location.pathname.split("/").pop() || "index.html";
  const isPublic = PUBLIC_PAGES.includes(page);
  const isAdmin  = ADMIN_PAGES.includes(page);

  // Hide body on protected pages until auth is confirmed —
  // prevents flash of content before redirect to login
  if (!isPublic) {
    document.body.style.visibility = "hidden";
  }

  _auth.onAuthStateChanged(async (user) => {
    if (!user && !isPublic) {
      location.href = "login.html";
      return;
    }

    if (user) {
      _currentUser = user;

      // Redirect away from auth pages if already signed in
      if (page === "login.html") {
        location.href = "index.html";
        return;
      }

      // Check admin access
      if (isAdmin && !ADMIN_UIDS.includes(user.uid)) {
        location.href = "index.html";
        return;
      }

      // Fetch user profile doc
      try {
        const snap = await _db.collection("users").doc(user.uid).get();
        if (!snap.exists && page !== "setup.html") {
          location.href = "setup.html";
          return;
        }
        _currentUser._profile = snap.exists ? snap.data() : null;
      } catch (e) {
        console.error("Error fetching user profile:", e);
      }

      // Render nav and start notification listener
      if (!isPublic) {
        document.body.style.visibility = "visible";
        renderNav();
        startNotificationListener();
      }
    }

    // Make public pages visible too
    if (isPublic) {
      document.body.style.visibility = "visible";
    }

    if (onReady) onReady(user);

    // After page is ready, check for new badges and show popup if needed
    // Run async so it doesn't block page render
    if (user && !isPublic) {
      setTimeout(async () => {
        const newBadges = await checkBadges();
        await showBadgePopupIfNeeded();

        // If new badges were awarded, re-read the profile and refresh badges section
        if (newBadges?.length && page === "profile.html" && profileUid === user.uid) {
          try {
            const snap = await _db.collection("users").doc(user.uid).get();
            if (snap.exists && snap.data().badges?.length) {
              _currentUser._profile = { ..._currentUser._profile, badges: snap.data().badges };
            }
          } catch (e) { /* silent */ }
        }
      }, 1500);
    }
  });
}

// ─── Navigation ──────────────────────────────────────────────
function renderNav() {
  const page = location.pathname.split("/").pop() || "index.html";

  const navItems = [
    { icon: "🏠", label: "Home",     href: "index.html"    },
    { icon: "📚", label: "Library",  href: "library.html"  },
    { icon: "🔍", label: "Discover", href: "search.html"   },
    { icon: "👥", label: "Clubs",    href: "clubs.html"    },
    { icon: "✉️",  label: "Messages", href: "messages.html" },
    { icon: "👤", label: "Profile",  href: `profile.html?uid=${_currentUser.uid}` }
  ];

  const navHTML = `
    <nav class="wr-nav" id="wrNav">
      <div class="wr-nav-inner">
        <a class="wr-nav-brand" href="index.html">
          <span class="wr-nav-logo">📖</span>
          <span class="wr-nav-title">${APP_NAME}</span>
        </a>
        <div class="wr-nav-links">
          ${navItems.map(item => {
            const active = page === item.href || page === item.href.split("?")[0];
            return `<a href="${item.href}" class="wr-nav-item${active ? " active" : ""}">
              <span class="wr-nav-icon">${item.icon}</span>
              <span class="wr-nav-label">${item.label}</span>
            </a>`;
          }).join("")}
          <button class="wr-nav-item wr-bell-btn" id="wrBellBtn" onclick="toggleNotifTray()" aria-label="Notifications">
            <span class="wr-nav-icon">🔔</span>
            <span class="wr-nav-label">Alerts</span>
            <span class="wr-bell-badge" id="wrBellBadge" style="display:none;">0</span>
          </button>
          <button class="wr-nav-item wr-signout-btn" onclick="signOut()" aria-label="Sign out" title="Sign out">
            <span class="wr-nav-icon">🚪</span>
            <span class="wr-nav-label">Sign Out</span>
          </button>
        </div>
      </div>
    </nav>
    <div class="wr-nav-spacer"></div>

    <!-- Mobile Bottom Tab Bar -->
    <nav class="wr-tab-bar" id="wrTabBar">
      ${navItems.map(item => {
        const active = page === item.href || page === item.href.split("?")[0];
        return `<a href="${item.href}" class="wr-tab-item${active ? " active" : ""}">
          <span class="wr-tab-icon">${item.icon}</span>
          <span class="wr-tab-label">${item.label}</span>
        </a>`;
      }).join("")}
      <button class="wr-tab-item wr-bell-btn" onclick="toggleNotifTray()" aria-label="Notifications">
        <span class="wr-tab-icon" style="position:relative;">
          🔔
          <span class="wr-bell-badge wr-bell-badge-mobile" id="wrBellBadgeMobile" style="display:none;">0</span>
        </span>
        <span class="wr-tab-label">Alerts</span>
      </button>
    </nav>

    <!-- Notification Tray -->
    <div class="wr-notif-overlay" id="wrNotifOverlay" onclick="closeNotifTray()"></div>
    <div class="wr-notif-tray" id="wrNotifTray">
      <div class="wr-notif-tray-header">
        <h3 class="wr-notif-tray-title">Notifications</h3>
        <button class="wr-notif-close" onclick="closeNotifTray()">✕</button>
      </div>
      <div class="wr-notif-tabs">
        <button class="wr-notif-tab active" id="tabActive" onclick="switchNotifTab('active')">Active</button>
        <button class="wr-notif-tab" id="tabPast" onclick="switchNotifTab('past')">Past</button>
      </div>
      <div class="wr-notif-list" id="wrNotifList">
        <div class="wr-notif-empty">Loading notifications...</div>
      </div>
    </div>

    <!-- Notification Detail Modal -->
    <div class="wr-modal-overlay" id="wrNotifModalOverlay" onclick="closeNotifModal()"></div>
    <div class="wr-modal wr-notif-modal" id="wrNotifModal">
      <div class="wr-modal-header">
        <h3 class="wr-modal-title" id="wrNotifModalTitle"></h3>
        <button class="wr-modal-close" onclick="closeNotifModal()">✕</button>
      </div>
      <div class="wr-modal-body" id="wrNotifModalBody"></div>
      <div class="wr-modal-footer" id="wrNotifModalFooter"></div>
    </div>
  `;

  // Inject nav styles
  if (!document.getElementById("wrNavStyles")) {
    const style = document.createElement("style");
    style.id = "wrNavStyles";
    style.textContent = getNavStyles();
    document.head.appendChild(style);
  }

  // Inject nav HTML at top of body
  const container = document.createElement("div");
  container.id = "wrNavContainer";
  container.innerHTML = navHTML;
  document.body.insertBefore(container, document.body.firstChild);
}

function getNavStyles() {
  return `
    /* ── Nav Bar (Desktop) ── */
    .wr-nav {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 900;
      background: #2D1B4E;
      box-shadow: 0 2px 12px rgba(45,27,78,0.18);
      height: 60px;
    }
    .wr-nav-inner {
      max-width: 1100px;
      margin: 0 auto;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
    }
    .wr-nav-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
    }
    .wr-nav-logo { font-size: 22px; }
    .wr-nav-title {
      font-family: 'Playfair Display', serif;
      font-size: 18px;
      color: #F7F3FF;
      letter-spacing: 0.01em;
    }
    .wr-nav-links {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .wr-nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 6px 12px;
      border-radius: 8px;
      text-decoration: none;
      background: none;
      border: none;
      cursor: pointer;
      transition: background 0.15s;
      position: relative;
    }
    .wr-nav-item:hover { background: rgba(255,255,255,0.08); }
    .wr-nav-item.active { background: rgba(201,168,76,0.18); }
    .wr-nav-icon { font-size: 18px; line-height: 1; }
    .wr-nav-label {
      font-family: 'Nunito Sans', sans-serif;
      font-size: 10px;
      color: #BDB5CC;
      white-space: nowrap;
    }
    .wr-nav-item.active .wr-nav-label { color: #C9A84C; }
    .wr-nav-spacer { height: 60px; }

    /* ── Sign Out Button ── */
    .wr-signout-btn {
      opacity: 0.7;
      transition: opacity 0.15s, background 0.15s !important;
    }
    .wr-signout-btn:hover { opacity: 1 !important; background: rgba(192,57,43,0.15) !important; }

    /* ── Bell Badge ── */
    .wr-bell-badge {
      position: absolute;
      top: 4px; right: 6px;
      background: #C0392B;
      color: #fff;
      font-family: 'Nunito Sans', sans-serif;
      font-size: 9px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 3px;
      border: 2px solid #2D1B4E;
    }
    .wr-bell-badge-mobile {
      position: absolute;
      top: -4px; right: -8px;
      border-color: #FAF6EE;
    }

    /* ── Mobile Tab Bar ── */
    .wr-tab-bar {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 900;
      background: #2D1B4E;
      box-shadow: 0 -2px 12px rgba(45,27,78,0.18);
      height: 64px;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .wr-tab-item {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      text-decoration: none;
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px 2px;
      position: relative;
      min-width: 0;
    }
    .wr-tab-icon { font-size: 18px; line-height: 1; }
    .wr-tab-label {
      font-family: 'Nunito Sans', sans-serif;
      font-size: 8px;
      color: #BDB5CC;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .wr-tab-item.active .wr-tab-label { color: #C9A84C; }

    /* ── Notification Tray ── */
    .wr-notif-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 950;
      background: rgba(45,27,78,0.3);
    }
    .wr-notif-overlay.open { display: block; }
    .wr-notif-tray {
      position: fixed;
      top: 60px; right: 0;
      width: 380px;
      max-height: calc(100vh - 80px);
      background: #FAF6EE;
      border-left: 1px solid #E8DFC8;
      border-bottom: 1px solid #E8DFC8;
      border-radius: 0 0 0 16px;
      box-shadow: -4px 4px 24px rgba(45,27,78,0.14);
      z-index: 960;
      display: flex;
      flex-direction: column;
      transform: translateX(110%);
      transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
    }
    .wr-notif-tray.open { transform: translateX(0); }
    .wr-notif-tray-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem 0.75rem;
      border-bottom: 1px solid #E8DFC8;
    }
    .wr-notif-tray-title {
      font-family: 'Playfair Display', serif;
      font-size: 18px;
      color: #2D1B4E;
      margin: 0;
    }
    .wr-notif-close {
      background: none;
      border: none;
      font-size: 16px;
      color: #A0674A;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      transition: background 0.15s;
    }
    .wr-notif-close:hover { background: #EDE4F7; }
    .wr-notif-tabs {
      display: flex;
      padding: 0.5rem 1.25rem 0;
      gap: 8px;
      border-bottom: 1px solid #E8DFC8;
    }
    .wr-notif-tab {
      background: none;
      border: none;
      font-family: 'Nunito Sans', sans-serif;
      font-size: 13px;
      font-weight: 500;
      color: #A0674A;
      padding: 6px 12px;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    }
    .wr-notif-tab.active {
      color: #7B5EA7;
      border-bottom-color: #7B5EA7;
    }
    .wr-notif-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }
    .wr-notif-empty {
      text-align: center;
      padding: 2rem 1rem;
      font-family: 'Nunito Sans', sans-serif;
      font-size: 14px;
      color: #A0674A;
    }
    .wr-notif-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 0.75rem;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
      margin-bottom: 2px;
    }
    .wr-notif-item:hover { background: #EDE4F7; }
    .wr-notif-item.unread { background: #F0EAF8; }
    .wr-notif-item.unread:hover { background: #E8DEFA; }
    .wr-notif-item-icon {
      font-size: 20px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .wr-notif-item-body { flex: 1; min-width: 0; }
    .wr-notif-item-title {
      font-family: 'Nunito Sans', sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #2D1B4E;
      margin: 0 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wr-notif-item-preview {
      font-family: 'Nunito Sans', sans-serif;
      font-size: 12px;
      color: #A0674A;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .wr-notif-item-time {
      font-family: 'Nunito Sans', sans-serif;
      font-size: 10px;
      color: #BDB5CC;
      margin: 3px 0 0;
    }
    .wr-unread-dot {
      width: 8px;
      height: 8px;
      background: #7B5EA7;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 5px;
    }

    /* ── Notification Detail Modal ── */
    .wr-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 970;
      background: rgba(45,27,78,0.45);
    }
    .wr-modal-overlay.open { display: block; }
    .wr-modal {
      position: fixed;
      z-index: 980;
      background: #FAF6EE;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(45,27,78,0.22);
      display: none;
      flex-direction: column;
      max-height: 80vh;
      overflow: hidden;
    }
    .wr-notif-modal {
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: min(480px, 94vw);
    }
    .wr-modal.open { display: flex; }
    .wr-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem 0.75rem;
      border-bottom: 1px solid #E8DFC8;
    }
    .wr-modal-title {
      font-family: 'Playfair Display', serif;
      font-size: 18px;
      color: #2D1B4E;
      margin: 0;
    }
    .wr-modal-close {
      background: none;
      border: none;
      font-size: 16px;
      color: #A0674A;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .wr-modal-close:hover { background: #EDE4F7; }
    .wr-modal-body {
      padding: 1.25rem 1.5rem;
      overflow-y: auto;
      font-family: 'Nunito Sans', sans-serif;
      font-size: 14px;
      color: #2D1B4E;
      line-height: 1.6;
    }
    .wr-modal-footer {
      padding: 0.75rem 1.5rem 1.25rem;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      border-top: 1px solid #E8DFC8;
    }

    /* ── Shared Button Styles ── */
    .wr-btn {
      font-family: 'Nunito Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .wr-btn:hover { opacity: 0.88; }
    .wr-btn:active { transform: scale(0.97); }
    .wr-btn-primary { background: #7B5EA7; color: #FAF6EE; }
    .wr-btn-secondary { background: transparent; color: #7B5EA7; border: 1.5px solid #7B5EA7; }
    .wr-btn-moss { background: #9DC4B0; color: #1A3D2E; }
    .wr-btn-gold { background: #C9A84C; color: #FAF6EE; }
    .wr-btn-danger { background: #C0392B; color: #fff; }
    .wr-btn-sm { font-size: 12px; padding: 6px 14px; }

    /* ── Toast ── */
    .wr-toast-container {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      pointer-events: none;
    }
    .wr-toast {
      background: #2D1B4E;
      color: #F7F3FF;
      font-family: 'Nunito Sans', sans-serif;
      font-size: 13px;
      font-weight: 500;
      padding: 10px 20px;
      border-radius: 24px;
      box-shadow: 0 4px 16px rgba(45,27,78,0.22);
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.25s, transform 0.25s;
      pointer-events: none;
      white-space: nowrap;
    }
    .wr-toast.show { opacity: 1; transform: translateY(0); }
    .wr-toast.success { background: #9DC4B0; color: #1A3D2E; }
    .wr-toast.error   { background: #C0392B; color: #fff; }
    .wr-toast.gold    { background: #C9A84C; color: #FAF6EE; }

    /* ── Star Rating ── */
    .wr-stars { display: inline-flex; gap: 2px; }
    .wr-star { font-size: 16px; color: #E8DFC8; }
    .wr-star.filled { color: #C9A84C; }

    /* ── Collapsible ── */
    .wr-collapsible-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 0.75rem 0;
      font-family: 'Playfair Display', serif;
      font-size: 16px;
      color: #2D1B4E;
      border-bottom: 1px solid #E8DFC8;
      user-select: none;
    }
    .wr-collapsible-arrow {
      font-size: 12px;
      color: #A0674A;
      transition: transform 0.2s;
    }
    .wr-collapsible-toggle.open .wr-collapsible-arrow {
      transform: rotate(180deg);
    }
    .wr-collapsible-body {
      display: none;
      padding: 0.75rem 0;
    }
    .wr-collapsible-body.open { display: block; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .wr-nav { display: none; }
      .wr-nav-spacer { height: 0; }
      .wr-tab-bar { display: flex; z-index: 950; }
      .wr-notif-overlay {
        bottom: calc(64px + env(safe-area-inset-bottom));
        z-index: 940;
      }
      .wr-notif-tray {
        top: auto;
        bottom: calc(64px + env(safe-area-inset-bottom));
        right: 0; left: 0;
        width: 100%;
        border-radius: 16px 16px 0 0;
        max-height: 70vh;
        transform: translateY(110%);
        z-index: 945;
      }
      .wr-notif-tray.open { transform: translateY(0); }
      .wr-modal-footer { flex-direction: column; }
      .wr-toast-container { bottom: 80px; }
    }
  `;
}

// ─── Notification Listener ───────────────────────────────────
let _currentNotifTab = "active";
let _activeNotifs  = [];
let _pastNotifs    = [];

function startNotificationListener() {
  if (_notifUnsubscribe) _notifUnsubscribe();

  _notifUnsubscribe = _db
    .collection("notifications")
    .doc(_currentUser.uid)
    .collection("items")
    .orderBy("createdAt", "desc")
    .limit(50)
    .onSnapshot((snap) => {
      _activeNotifs = [];
      _pastNotifs   = [];
      let unread    = 0;

      snap.forEach(doc => {
        const n = { id: doc.id, ...doc.data() };
        if (n.dismissed) {
          _pastNotifs.push(n);
        } else {
          _activeNotifs.push(n);
          if (!n.read) unread++;
        }
      });

      _unreadCount = unread;
      updateBellBadge();
      renderNotifList();
    }, (err) => {
      console.error("Notification listener error:", err);
    });
}

function updateBellBadge() {
  const badge       = document.getElementById("wrBellBadge");
  const badgeMobile = document.getElementById("wrBellBadgeMobile");
  const show        = _unreadCount > 0;
  const label       = _unreadCount > 99 ? "99+" : String(_unreadCount);

  [badge, badgeMobile].forEach(el => {
    if (!el) return;
    el.textContent    = label;
    el.style.display  = show ? "flex" : "none";
  });
}

function renderNotifList() {
  const list = document.getElementById("wrNotifList");
  if (!list) return;

  const notifs = _currentNotifTab === "active" ? _activeNotifs : _pastNotifs;

  if (notifs.length === 0) {
    list.innerHTML = `<div class="wr-notif-empty">${
      _currentNotifTab === "active"
        ? "You're all caught up! 🎉"
        : "No past notifications."
    }</div>`;
    return;
  }

  list.innerHTML = notifs.map(n => `
    <div class="wr-notif-item${!n.read ? " unread" : ""}"
         onclick="openNotifDetail('${n.id}')">
      <div class="wr-notif-item-icon">${getNotifIcon(n.type)}</div>
      <div class="wr-notif-item-body">
        <p class="wr-notif-item-title">${escapeHTML(n.title || "Notification")}</p>
        <p class="wr-notif-item-preview">${escapeHTML(n.body || "")}</p>
        <p class="wr-notif-item-time">${formatRelativeTime(n.createdAt)}</p>
      </div>
      ${!n.read ? '<div class="wr-unread-dot"></div>' : ""}
    </div>
  `).join("");
}

function getNotifIcon(type) {
  const icons = {
    friend_request:  "👤",
    club_invite:     "👥",
    club_admin:      "⭐",
    club_event:      "📅",
    monthly_goal:    "🎯",
    app_admin:       "📢",
    book_lent:       "📚",
    message:         "✉️"
  };
  return icons[type] || "🔔";
}

function switchNotifTab(tab) {
  _currentNotifTab = tab;
  document.getElementById("tabActive").classList.toggle("active", tab === "active");
  document.getElementById("tabPast").classList.toggle("active", tab === "past");
  renderNotifList();
}

function toggleNotifTray() {
  const tray    = document.getElementById("wrNotifTray");
  const overlay = document.getElementById("wrNotifOverlay");
  const isOpen  = tray.classList.contains("open");

  if (isOpen) {
    closeNotifTray();
  } else {
    tray.classList.add("open");
    overlay.classList.add("open");
    // Mark active notifications as read
    markNotifsRead();
  }
}

function closeNotifTray() {
  document.getElementById("wrNotifTray")?.classList.remove("open");
  document.getElementById("wrNotifOverlay")?.classList.remove("open");
}

function markNotifsRead() {
  const batch = _db.batch();
  _activeNotifs.forEach(n => {
    if (!n.read) {
      const ref = _db
        .collection("notifications")
        .doc(_currentUser.uid)
        .collection("items")
        .doc(n.id);
      batch.update(ref, { read: true });
    }
  });
  batch.commit().catch(e => console.error("Error marking read:", e));
}

function openNotifDetail(notifId) {
  const notif = [..._activeNotifs, ..._pastNotifs].find(n => n.id === notifId);
  if (!notif) return;

  document.getElementById("wrNotifModalTitle").textContent = notif.title || "Notification";
  document.getElementById("wrNotifModalBody").innerHTML    = `
    <p style="margin:0 0 1rem;color:#A0674A;font-size:12px;">${formatFullDate(notif.createdAt)}</p>
    <div>${notif.bodyHTML || escapeHTML(notif.body || "")}</div>
  `;

  // Footer actions based on type
  const footer = document.getElementById("wrNotifModalFooter");
  footer.innerHTML = buildNotifModalFooter(notif);

  document.getElementById("wrNotifModal").classList.add("open");
  document.getElementById("wrNotifModalOverlay").classList.add("open");

  // Mark as read when opened (but NOT dismissed — stays in active until acted on)
  if (!notif.read) {
    _db.collection("notifications")
      .doc(_currentUser.uid)
      .collection("items")
      .doc(notifId)
      .update({ read: true })
      .catch(e => console.error("Error marking notif read:", e));
    notif.read = true;
  }
}

function buildNotifModalFooter(notif) {
  // Past notifications — show what action was taken, no buttons
  if (notif.dismissed) {
    const label = notif.actionTaken || "Dismissed";
    return `<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--terracotta);">
      <span style="font-size:16px;">✓</span>
      <span>${escapeHTML(label)}</span>
    </div>`;
  }

  // Active notifications — show action buttons
  switch (notif.type) {
    case "friend_request":
      return `
        <button class="wr-btn wr-btn-secondary wr-btn-sm" onclick="declineFriendRequest('${notif.linkedId}','${notif.id}');closeNotifModal()">Decline</button>
        <button class="wr-btn wr-btn-primary wr-btn-sm" onclick="acceptFriendRequest('${notif.linkedId}','${notif.id}');closeNotifModal()">Accept</button>
      `;
    case "club_invite":
      return `
        <button class="wr-btn wr-btn-secondary wr-btn-sm" onclick="declineClubInvite('${notif.linkedId}','${notif.id}');closeNotifModal()">Decline</button>
        <button class="wr-btn wr-btn-moss wr-btn-sm" onclick="acceptClubInvite('${notif.linkedId}','${notif.id}');closeNotifModal()">Join Club</button>
      `;
    case "club_event":
      return `<button class="wr-btn wr-btn-primary wr-btn-sm" onclick="dismissNotif('${notif.id}','Viewed');location.href='club.html?id=${notif.linkedId}'">View Club</button>`;
    default:
      return `<button class="wr-btn wr-btn-secondary wr-btn-sm" onclick="dismissNotif('${notif.id}','Dismissed');closeNotifModal()">Dismiss</button>`;
  }
}

function closeNotifModal() {
  document.getElementById("wrNotifModal")?.classList.remove("open");
  document.getElementById("wrNotifModalOverlay")?.classList.remove("open");
}

// ─── Notification Writer ─────────────────────────────────────
// Call this from any page to create a notification for a user.
async function createNotification(targetUid, { type, title, body, bodyHTML, linkedId }) {
  try {
    await _db
      .collection("notifications")
      .doc(targetUid)
      .collection("items")
      .add({
        type:         type || "app_admin",
        title:        title || "",
        body:         body  || "",
        bodyHTML:     bodyHTML || null,
        linkedId:     linkedId || null,
        read:         false,
        dismissed:    false,
        createdByUid: _currentUser?.uid || null,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch (e) {
    console.error("Error creating notification:", e);
  }
}

// ─── Friend Actions ──────────────────────────────────────────
// Stub functions — full logic lives in profile.html and friends feature
async function dismissNotif(notifId, actionTaken) {
  if (!notifId || !_currentUser) return;
  try {
    const update = { dismissed: true, read: true };
    if (actionTaken) update.actionTaken = actionTaken;
    await _db.collection("notifications")
      .doc(_currentUser.uid)
      .collection("items")
      .doc(notifId)
      .update(update);
  } catch (e) { console.error("Dismiss notif error:", e); }
}

async function acceptFriendRequest(friendshipId, notifId) {
  try {
    const friendSnap = await _db.collection("friends").doc(friendshipId).get();
    const users = friendSnap.exists ? friendSnap.data().users : [];

    await _db.collection("friends").doc(friendshipId).update({
      status: "accepted",
      acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Maintain friendsList and friendCount on both user docs
    if (users.length === 2) {
      await Promise.all([
        _db.collection("users").doc(users[0]).set({
          friendsList:  firebase.firestore.FieldValue.arrayUnion(users[1]),
          friendCount:  firebase.firestore.FieldValue.increment(1)
        }, { merge: true }),
        _db.collection("users").doc(users[1]).set({
          friendsList:  firebase.firestore.FieldValue.arrayUnion(users[0]),
          friendCount:  firebase.firestore.FieldValue.increment(1)
        }, { merge: true })
      ]);
    }

    if (notifId) await dismissNotif(notifId, "Friend request accepted");
    showToast("Friend request accepted! 🎉", "success");
  } catch (e) {
    showToast("Error accepting request.", "error");
  }
}

async function declineFriendRequest(friendshipId, notifId) {
  try {
    await _db.collection("friends").doc(friendshipId).delete();
    if (notifId) await dismissNotif(notifId, "Friend request declined");
    showToast("Friend request declined.");
  } catch (e) {
    showToast("Error declining request.", "error");
  }
}

async function acceptClubInvite(clubId, notifId) {
  const uid = _currentUser.uid;
  try {
    const profile = _currentUser._profile;

    // Add member doc
    await _db.collection("clubs").doc(clubId)
      .collection("members").doc(uid).set({
        uid,
        displayName: profile?.displayName || "",
        photoURL:    profile?.photoURL    || null,
        role:        "member",
        status:      "active",
        joinedAt:    firebase.firestore.FieldValue.serverTimestamp()
      });

    // Update memberUids on club doc
    await _db.collection("clubs").doc(clubId).update({
      memberUids: firebase.firestore.FieldValue.arrayUnion(uid)
    });

    // Delete the pending invite doc so it clears from the invited list
    try {
      const invitesSnap = await _db
        .collection("clubs").doc(clubId)
        .collection("invites")
        .where("invitedUid", "==", uid)
        .where("status", "==", "pending")
        .limit(1)
        .get();
      if (!invitesSnap.empty) {
        await invitesSnap.docs[0].ref.delete();
      }
    } catch (e) { console.error("Invite cleanup error:", e); }

    if (notifId) await dismissNotif(notifId, "Joined club");
    showToast("You joined the club! 👥", "success");
    setTimeout(() => { location.href = "club.html?id=" + clubId; }, 800);
  } catch (e) {
    console.error("Accept club invite error:", e);
    showToast("Something went wrong joining the club.", "error");
  }
}

async function declineClubInvite(clubId, notifId) {
  try {
    // Delete the pending invite doc so the person can be re-invited
    const invitesSnap = await _db
      .collection("clubs").doc(clubId)
      .collection("invites")
      .where("invitedUid", "==", _currentUser.uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!invitesSnap.empty) {
      await invitesSnap.docs[0].ref.delete();
    }
  } catch (e) {
    console.error("Decline invite cleanup error:", e);
  }
  if (notifId) await dismissNotif(notifId, "Invite declined");
  showToast("Invite declined.");
}

// ─── Toast ───────────────────────────────────────────────────
function showToast(message, type = "default") {
  let container = document.getElementById("wrToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "wrToastContainer";
    container.className = "wr-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `wr-toast${type !== "default" ? " " + type : ""}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  });
}

// ─── Star Rating Renderer ─────────────────────────────────────
function renderStars(rating, maxStars = 5) {
  let html = '<span class="wr-stars">';
  for (let i = 1; i <= maxStars; i++) {
    html += `<span class="wr-star${i <= rating ? " filled" : ""}">★</span>`;
  }
  html += "</span>";
  return html;
}

// Interactive star picker — returns HTML, call initStarPicker() after inserting
function renderStarPicker(containerId, initialRating = 0, onSelect) {
  if (!document.getElementById("wrStarPickerStyle")) {
    const s = document.createElement("style");
    s.id = "wrStarPickerStyle";
    s.textContent = `
      .wr-star-picker { display:inline-flex; gap:4px; cursor:pointer; user-select:none; }
      .wr-star-pick { font-size:24px; color:#E8DFC8; transition:color 0.1s; line-height:1; }
      .wr-star-pick.filled { color:#C9A84C; }
      .wr-star-pick.hover  { color:#C9A84C; }
    `;
    document.head.appendChild(s);
  }

  // Store callback and current value keyed by containerId
  _starPickerCallbacks[containerId] = onSelect;
  _starPickerValues[containerId]    = initialRating;

  return `
    <div class="wr-star-picker" id="${containerId}" data-rating="${initialRating}">
      ${[1,2,3,4,5].map(i => `
        <span class="wr-star-pick${i <= initialRating ? " filled" : ""}"
              data-val="${i}">★</span>
      `).join("")}
    </div>
  `;
}

// Call this after inserting renderStarPicker HTML into the DOM
function initStarPicker(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.querySelectorAll(".wr-star-pick").forEach(star => {
    const val = parseInt(star.dataset.val);

    star.addEventListener("mouseover", () => {
      container.querySelectorAll(".wr-star-pick").forEach(s => {
        s.classList.toggle("hover", parseInt(s.dataset.val) <= val);
      });
    });

    star.addEventListener("mouseout", () => {
      const current = _starPickerValues[containerId] || 0;
      container.querySelectorAll(".wr-star-pick").forEach(s => {
        s.classList.remove("hover");
        s.classList.toggle("filled", parseInt(s.dataset.val) <= current);
      });
    });

    star.addEventListener("click", () => {
      _starPickerValues[containerId] = val;
      container.dataset.rating       = val;
      container.querySelectorAll(".wr-star-pick").forEach(s => {
        s.classList.remove("hover");
        s.classList.toggle("filled", parseInt(s.dataset.val) <= val);
      });
      if (_starPickerCallbacks[containerId]) {
        _starPickerCallbacks[containerId](val);
      }
    });
  });
}

const _starPickerValues    = {};
const _starPickerCallbacks = {};

// ─── Collapsible Sections ────────────────────────────────────
function initCollapsibles() {
  document.querySelectorAll(".wr-collapsible-toggle").forEach(toggle => {
    toggle.addEventListener("click", () => {
      const bodyId = toggle.dataset.target;
      const body   = document.getElementById(bodyId);
      if (!body) return;
      const isOpen = body.classList.contains("open");
      toggle.classList.toggle("open", !isOpen);
      body.classList.toggle("open", !isOpen);
    });
  });
}

// ─── Book Card HTML ──────────────────────────────────────────
// Reusable book card for search results, library, etc.
function buildBookCard(book, actions = []) {
  const cover = book.coverURL
    ? `<img src="${book.coverURL}" alt="Cover" class="wr-book-cover-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : "";
  return `
    <div class="wr-book-card" data-book-id="${book.bookId || book.isbn13 || ""}">
      <a href="book.html?id=${book.bookId || book.isbn13 || ""}" class="wr-book-cover-link">
        <div class="wr-book-cover">
          ${cover}
          <div class="wr-book-cover-placeholder" style="${book.coverURL ? "display:none" : ""}">📖</div>
        </div>
      </a>
      <div class="wr-book-info">
        <a href="book.html?id=${book.bookId || book.isbn13 || ""}" class="wr-book-title-link">
          <h3 class="wr-book-title">${escapeHTML(book.title || "Unknown Title")}</h3>
        </a>
        <p class="wr-book-author">${escapeHTML(Array.isArray(book.authors) ? book.authors.join(", ") : (book.author || "Unknown Author"))}</p>
        ${book.averageRating ? renderStars(Math.round(book.averageRating)) : ""}
        <div class="wr-book-actions">
          ${actions.map(a => `<button class="wr-btn wr-btn-sm ${a.class || "wr-btn-primary"}" onclick="${a.onclick}">${a.label}</button>`).join("")}
        </div>
      </div>
    </div>
  `;
}

// ─── Google Books API ────────────────────────────────────────
async function searchGoogleBooks(query) {
  const encoded = encodeURIComponent(query);
  const url     = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=20&key=AIzaSyCdPs_QjB6XKHcx3Q18WQcqQezDn8hYVCo`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.items) return [];
    return data.items.map(normalizeGoogleBook);
  } catch (e) {
    console.error("Google Books API error:", e);
    return [];
  }
}

async function searchGoogleBooksTitle(query) {
  // Run intitle: search in parallel with plain search for better title matching
  const encoded     = encodeURIComponent(query);
  const encodedIT   = encodeURIComponent(`intitle:${query}`);
  const [plain, titled] = await Promise.all([
    fetch(`https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=20&key=AIzaSyCdPs_QjB6XKHcx3Q18WQcqQezDn8hYVCo`)
      .then(r => r.json()).then(d => d.items || []).catch(() => []),
    fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodedIT}&maxResults=10&key=AIzaSyCdPs_QjB6XKHcx3Q18WQcqQezDn8hYVCo`)
      .then(r => r.json()).then(d => d.items || []).catch(() => [])
  ]);

  // Merge — intitle results first, then plain, deduped by volumeId
  const seen = new Set();
  return [...titled, ...plain]
    .filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map(normalizeGoogleBook);
}

async function getGoogleBookByISBN(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=AIzaSyCdPs_QjB6XKHcx3Q18WQcqQezDn8hYVCo`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (data.items?.length) return normalizeGoogleBook(data.items[0]);
  } catch (e) {
    console.error("Google Books ISBN lookup error:", e);
  }

  // Fall back to Open Library if Google returns nothing
  return await getOpenLibraryByISBN(isbn);
}

async function getOpenLibraryByISBN(isbn) {
  try {
    const res  = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (!res.ok) return null;
    const data = await res.json();

    // Fetch work and author details
    const workKey  = data.works?.[0]?.key;
    const authorKey = data.authors?.[0]?.key;

    const [work, author] = await Promise.all([
      workKey  ? fetch(`https://openlibrary.org${workKey}.json`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
      authorKey ? fetch(`https://openlibrary.org${authorKey}.json`).then(r => r.json()).catch(() => null) : Promise.resolve(null)
    ]);

    const title       = data.title || work?.title || "Unknown Title";
    const authorName  = author?.name || "";
    const description = typeof work?.description === "string"
      ? work.description
      : work?.description?.value || "";
    const cover       = data.covers?.[0]
      ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`
      : null;

    return {
      bookId:        isbn,
      googleBooksId: null,
      isbn13:        isbn,
      isbn10:        null,
      title,
      authors:       authorName ? [authorName] : [],
      description,
      publisher:     data.publishers?.[0] || "",
      publishedDate: data.publish_date    || "",
      pageCount:     data.number_of_pages || null,
      categories:    [],
      coverURL:      cover,
      seriesInfo:    null,
      averageRating: null,
      ratingsCount:  0,
      source:        "openlibrary"
    };
  } catch (e) {
    console.error("Open Library ISBN lookup error:", e);
    return null;
  }
}

function normalizeGoogleBook(item) {
  const info    = item.volumeInfo || {};
  const isbns   = info.industryIdentifiers || [];
  const isbn13  = isbns.find(i => i.type === "ISBN_13")?.identifier || null;
  const isbn10  = isbns.find(i => i.type === "ISBN_10")?.identifier || null;
  const cover   = info.imageLinks?.thumbnail?.replace("http://", "https://") || null;

  // Surface series info — check seriesInfo field first, then subtitle
  // (Google often encodes series in the subtitle e.g. "Harry Potter, Book 1")
  let seriesInfo = null;
  if (info.seriesInfo?.bookDisplayNumber) {
    seriesInfo = `Book ${info.seriesInfo.bookDisplayNumber} in series`;
  } else if (info.subtitle) {
    // Many series books have subtitles like "Book 1 of the XYZ series" or "Harry Potter #1"
    const sub = info.subtitle;
    const seriesMatch = sub.match(/book\s+(\d+)/i) || sub.match(/#(\d+)/);
    if (seriesMatch) {
      seriesInfo = `Book ${seriesMatch[1]}${sub.length < 60 ? " — " + sub : ""}`;
    } else if (/series|trilogy|saga|chronicles|sequence/i.test(sub)) {
      seriesInfo = sub;
    }
  }

  return {
    bookId:        isbn13 || item.id,
    googleBooksId: item.id,
    isbn13,
    isbn10,
    title:         info.title         || "Unknown Title",
    authors:       info.authors        || [],
    description:   info.description    || "",
    publisher:     info.publisher      || "",
    publishedDate: info.publishedDate  || "",
    pageCount:     info.pageCount      || null,
    categories:    info.categories     || [],
    coverURL:      cover,
    seriesInfo,
    averageRating: null,
    ratingsCount:  0
  };
}

// ─── Firestore — Book DB ─────────────────────────────────────
async function lookupBook(query, type = "text") {
  // ISBN search — check Firestore first, it's exact match so no need for Google
  if (type === "isbn") {
    try {
      const snap = await _db.collection("books")
        .where("isbn13", "==", query).limit(1).get();
      if (!snap.empty) return [{ id: snap.docs[0].id, ...snap.docs[0].data() }];
    } catch (e) { console.error("ISBN DB search error:", e); }
    const result = await getGoogleBookByISBN(query);
    return result ? [result] : [];
  }

  // Text search — always hit Google Books for comprehensive results.
  // Merge in any Firestore matches so we keep community data (ratings etc)
  // but never let Firestore results block the Google Books response.
  const [apiResults, internalMap] = await Promise.all([
    searchGoogleBooksTitle(query).catch(() => []),
    (async () => {
      const map = {};
      try {
        const snap = await _db.collection("books")
          .orderBy("addedAt", "desc").limit(200).get();
        const q = query.toLowerCase();
        snap.docs.forEach(d => {
          const b = d.data();
          if (
            (b.title  || "").toLowerCase().includes(q) ||
            (b.authors || []).some(a => a.toLowerCase().includes(q))
          ) {
            map[b.isbn13 || b.googleBooksId] = { id: d.id, ...b };
          }
        });
      } catch (e) { console.error("Internal DB search error:", e); }
      return map;
    })()
  ]);

  // Merge: if a Google Books result is already in Firestore, use the Firestore
  // doc (richer data) but keep Google Books position in the list
  return apiResults.map(book => {
    const key = book.isbn13 || book.googleBooksId;
    return internalMap[key] || book;
  });
}

async function saveBookToDb(book) {
  if (!book.bookId) return;
  try {
    await _db.collection("books").doc(book.bookId).set({
      bookId:        book.bookId,
      googleBooksId: book.googleBooksId || null,
      isbn13:        book.isbn13  || null,
      isbn10:        book.isbn10  || null,
      title:         book.title   || "",
      authors:       book.authors || [],
      description:   book.description   || "",
      publisher:     book.publisher     || "",
      publishedDate: book.publishedDate || "",
      pageCount:     book.pageCount     || null,
      categories:    book.categories    || [],
      coverURL:      book.coverURL      || null,
      averageRating: book.averageRating || null,
      ratingsCount:  book.ratingsCount  || 0,
      addedAt:       firebase.firestore.FieldValue.serverTimestamp(),
      addedByUid:    _currentUser?.uid || null
    }, { merge: true });
  } catch (e) {
    console.error("Error saving book to DB:", e);
  }
}

// ─── User Book Actions ───────────────────────────────────────
async function addBookToUserCollection(book, flags = {}) {
  if (!_currentUser || !book.bookId) return false;

  // Ensure book exists in global DB
  await saveBookToDb(book);

  const ref = _db
    .collection("users")
    .doc(_currentUser.uid)
    .collection("books")
    .doc(book.bookId);

  try {
    // Build the update — only include flag fields that were explicitly passed
    // so we never accidentally overwrite existing flags with false
    const data = {
      bookId:    book.bookId,
      isbn:      book.isbn13  || book.isbn10 || null,
      title:     book.title   || "",
      author:    Array.isArray(book.authors) ? book.authors.join(", ") : (book.author || ""),
      coverURL:  book.coverURL || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Only set these if explicitly provided in flags
    if (flags.inLibrary  !== undefined) data.inLibrary  = flags.inLibrary;
    if (flags.onReadList !== undefined) data.onReadList = flags.onReadList;
    if (flags.onWishlist !== undefined) data.onWishlist = flags.onWishlist;
    if (flags.onTBR      !== undefined) data.onTBR      = flags.onTBR;
    if (flags.tbrNeedsAcquisition !== undefined) data.tbrNeedsAcquisition = flags.tbrNeedsAcquisition;

    // Only set these on first add (merge:true won't overwrite existing arrays)
    const snap = await ref.get();
    if (!snap.exists) {
      data.readingSessions = [];
      data.lendingHistory  = [];
      data.clubReads       = [];
      data.addedAt         = firebase.firestore.FieldValue.serverTimestamp();
    }

    await ref.set(data, { merge: true });
    return true;
  } catch (e) {
    console.error("Error adding book to user collection:", e);
    return false;
  }
}

async function getUserBook(bookId) {
  if (!_currentUser) return null;
  try {
    const snap = await _db
      .collection("users")
      .doc(_currentUser.uid)
      .collection("books")
      .doc(bookId)
      .get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    console.error("Error fetching user book:", e);
    return null;
  }
}

// ─── Utility Functions ───────────────────────────────────────
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now   = new Date();
  const diffMs = now - date;
  const diffM  = Math.floor(diffMs / 60000);
  const diffH  = Math.floor(diffMs / 3600000);
  const diffD  = Math.floor(diffMs / 86400000);

  if (diffM < 1)  return "just now";
  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 7)  return `${diffD}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateInput(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function generateId() {
  return _db ? _db.collection("_").doc().id : Math.random().toString(36).slice(2);
}

function getFriendshipId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

// ─── Sign Out ─────────────────────────────────────────────────
async function signOut() {
  try {
    if (_notifUnsubscribe) _notifUnsubscribe();
    await _auth.signOut();
    location.href = "login.html";
  } catch (e) {
    console.error("Sign out error:", e);
  }
}

// ─── Cloudflare Worker Caller ────────────────────────────────
async function callWorker(action, data = {}) {
  try {
    const res = await fetch(WORKER_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action, ...data })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Worker error response:", err);
      return { error: err.error || "Worker error" };
    }
    return await res.json();
  } catch (e) {
    console.error("Worker call failed:", e);
    return { error: e.message };
  }
}

// ─── Expose globals ──────────────────────────────────────────
// These need to be on window so HTML event handlers can reach them
window.toggleNotifTray    = toggleNotifTray;
window.closeNotifTray     = closeNotifTray;
window.switchNotifTab     = switchNotifTab;
window.openNotifDetail    = openNotifDetail;
window.closeNotifModal    = closeNotifModal;
window.acceptFriendRequest  = acceptFriendRequest;
window.declineFriendRequest = declineFriendRequest;
window.acceptClubInvite     = acceptClubInvite;
window.declineClubInvite    = declineClubInvite;
window.dismissNotif         = dismissNotif;
window.signOut            = signOut;

// ─── Exported API ────────────────────────────────────────────
// ─── Badge System ─────────────────────────────────────────────

const BADGE_DEFS = {
  // Monthly goal badges (generated dynamically for each YYYY-MM)
  goal_met:       { name: "On Track",         icon: "🎯", desc: "Met your monthly reading goal",           rarity: "common"    },
  goal_surpassed: { name: "Overachiever",      icon: "🏆", desc: "Surpassed your monthly reading goal",    rarity: "rare"      },
  // Streak badges
  streak_3:       { name: "Hat Trick",         icon: "🔥", desc: "Met your goal 3 months in a row",        rarity: "uncommon"  },
  streak_6:       { name: "On a Roll",         icon: "🚀", desc: "Met your goal 6 months in a row",        rarity: "rare"      },
  streak_12:      { name: "Year of Reading",   icon: "🌟", desc: "Met your goal 12 months in a row",       rarity: "legendary" },
  // Books read
  read_10:        { name: "Getting Cozy",      icon: "📖", desc: "Read 10 books",                          rarity: "common"    },
  read_25:        { name: "Bookworm",          icon: "🪱", desc: "Read 25 books",                          rarity: "uncommon"  },
  read_50:        { name: "Page Turner",       icon: "📚", desc: "Read 50 books",                          rarity: "rare"      },
  read_100:       { name: "Literary Legend",   icon: "👑", desc: "Read 100 books",                         rarity: "legendary" },
  // Reviews
  review_5:       { name: "Critic's Corner",   icon: "✍️", desc: "Wrote 5 book reviews",                   rarity: "common"    },
  review_25:      { name: "The Reviewer",      icon: "📝", desc: "Wrote 25 book reviews",                  rarity: "uncommon"  },
  review_50:      { name: "Voice of the People", icon: "📣", desc: "Wrote 50 book reviews",                rarity: "rare"      },
  // Social
  club_joined:    { name: "Social Reader",     icon: "👥", desc: "Joined your first book club",            rarity: "common"    },
  club_founded:   { name: "Club Founder",      icon: "🏛️", desc: "Created a book club",                   rarity: "uncommon"  },
  friend_5:       { name: "Well-Connected",    icon: "🤝", desc: "Made 5 friends on WellRead Co.",         rarity: "common"    },
  // Library
  wishlist_10:    { name: "Ambitious Reader",  icon: "⭐", desc: "Added 10 books to your wishlist",        rarity: "common"    },
  dnf_3:          { name: "Life's Too Short",  icon: "🚪", desc: "DNF'd 3 books — no shame in that!",     rarity: "common"    },
};

const RARITY_COLORS = {
  common:    { bg: "#EDE4F7", text: "#5B3E8A", border: "#C9B8E8" },
  uncommon:  { bg: "#DCF0E8", text: "#2E6B50", border: "#9DC4B0" },
  rare:      { bg: "#FEF3CD", text: "#8B6914", border: "#E8D88A" },
  legendary: { bg: "#FCE8E8", text: "#8B2020", border: "#F5C6C6" },
};

function getBadgeDef(badgeId) {
  // Handle dynamic goal badges like "goal_met_2025_06"
  if (badgeId.startsWith("goal_met_"))       return { ...BADGE_DEFS.goal_met,       id: badgeId };
  if (badgeId.startsWith("goal_surpassed_")) return { ...BADGE_DEFS.goal_surpassed, id: badgeId };
  return BADGE_DEFS[badgeId] ? { ...BADGE_DEFS[badgeId], id: badgeId } : null;
}

function getBadgeMonthLabel(badgeId) {
  const parts = badgeId.split("_");
  if (parts.length < 5) return "";
  const year  = parts[parts.length - 2];
  const month = parts[parts.length - 1];
  try {
    return new Date(year, parseInt(month) - 1, 1)
      .toLocaleString("default", { month: "long", year: "numeric" });
  } catch { return ""; }
}

async function checkBadges(context = {}) {
  if (!_currentUser) return [];
  const uid = _currentUser.uid;

  try {
    // Load current badge state and user data
    const userSnap   = await _db.collection("users").doc(uid).get();
    const userData   = userSnap.exists ? userSnap.data() : {};
    const existing   = new Set((userData.badges || []).map(b => b.id));
    const newBadges  = [];

    // Load books for count-based badges
    const booksSnap  = await _db.collection("users").doc(uid).collection("books").get();
    const books      = booksSnap.docs.map(d => d.data());

    const totalRead  = books.filter(b => b.readingSessions?.some(s => s.completed)).length;
    const totalDNF   = books.reduce((acc, b) => acc + (b.readingSessions?.filter(s => s.dnf).length || 0), 0);
    const totalWish  = books.filter(b => b.onWishlist).length;
    const totalReviews = books.filter(b => b.readingSessions?.some(s => s.review)).length;

    // Books read thresholds
    for (const [id, threshold] of [["read_10",10],["read_25",25],["read_50",50],["read_100",100]]) {
      if (totalRead >= threshold && !existing.has(id)) newBadges.push(id);
    }

    // Reviews
    for (const [id, threshold] of [["review_5",5],["review_25",25],["review_50",50]]) {
      if (totalReviews >= threshold && !existing.has(id)) newBadges.push(id);
    }

    // Wishlist
    if (totalWish >= 10 && !existing.has("wishlist_10")) newBadges.push("wishlist_10");

    // DNF
    if (totalDNF >= 3 && !existing.has("dnf_3")) newBadges.push("dnf_3");

    // Club badges from context
    if (context.joinedClub && !existing.has("club_joined")) newBadges.push("club_joined");
    if (context.foundedClub && !existing.has("club_founded")) newBadges.push("club_founded");

    // Friend count
    if (context.friendCount >= 5 && !existing.has("friend_5")) newBadges.push("friend_5");

    // Monthly goal and streak badges from goalHistory
    const history = userData.goalHistory || {};
    const metMonths = Object.entries(history)
      .filter(([, v]) => v.met)
      .map(([k]) => k)
      .sort();

    for (const [month, entry] of Object.entries(history)) {
      const metId  = `goal_met_${month.replace("-","_")}`;
      const surpId = `goal_surpassed_${month.replace("-","_")}`;
      if (entry.met       && !existing.has(metId))  newBadges.push(metId);
      if (entry.surpassed && !existing.has(surpId)) newBadges.push(surpId);
    }

    // Streak badges — check for consecutive months
    const streak = longestCurrentStreak(metMonths);
    if (streak >= 3  && !existing.has("streak_3"))  newBadges.push("streak_3");
    if (streak >= 6  && !existing.has("streak_6"))  newBadges.push("streak_6");
    if (streak >= 12 && !existing.has("streak_12")) newBadges.push("streak_12");

    if (!newBadges.length) return [];

    // Award new badges
    const now        = firebase.firestore.FieldValue.serverTimestamp();
    const newEntries = newBadges.map(id => ({ id, earnedAt: new Date().toISOString(), seen: false }));

    await _db.collection("users").doc(uid).update({
      badges: firebase.firestore.FieldValue.arrayUnion(...newEntries)
    });

    // Create friend activity notifications for each new badge
    try {
      const friendsSnap = await _db.collection("friends")
        .where("users", "array-contains", uid)
        .where("status", "==", "accepted")
        .get();

      const friendUids = friendsSnap.docs
        .map(d => d.data().users.find(u => u !== uid))
        .filter(Boolean);

      const profile  = _currentUser._profile;
      const name     = profile?.displayName || "A reader";

      await Promise.all(newBadges.flatMap(badgeId => {
        const def = getBadgeDef(badgeId);
        if (!def) return [];
        return friendUids.map(fuid => createNotification(fuid, {
          type:    "badge_earned",
          title:   `${name} earned a badge!`,
          body:    `${def.icon} ${def.name} — ${def.desc}`,
          linkedId: uid
        }));
      }));
    } catch (e) { console.error("Badge friend notify error:", e); }

    return newBadges;
  } catch (e) {
    console.error("Badge check error:", e);
    return [];
  }
}

function longestCurrentStreak(sortedMonths) {
  if (!sortedMonths.length) return 0;
  // Walk backwards from most recent month checking consecutive months
  let streak = 1;
  for (let i = sortedMonths.length - 1; i > 0; i--) {
    const curr = sortedMonths[i];
    const prev = sortedMonths[i - 1];
    const [cy, cm] = curr.split("-").map(Number);
    const [py, pm] = prev.split("-").map(Number);
    const expectedPrev = cm === 1
      ? `${cy - 1}-12`
      : `${cy}-${String(cm - 1).padStart(2, "0")}`;
    if (prev === expectedPrev) { streak++; }
    else break;
  }
  return streak;
}

// Show a popup for newly earned badges (called on login)
async function showBadgePopupIfNeeded() {
  if (!_currentUser) return;
  const uid = _currentUser.uid;
  try {
    const snap = await _db.collection("users").doc(uid).get();
    if (!snap.exists) return;
    const unseen = (snap.data().badges || []).filter(b => !b.seen);
    if (!unseen.length) return;

    // Mark all as seen
    const allBadges = (snap.data().badges || []).map(b => ({ ...b, seen: true }));
    await _db.collection("users").doc(uid).update({ badges: allBadges });

    // Build popup HTML
    const badgeItems = unseen.map(b => {
      const def    = getBadgeDef(b.id);
      if (!def) return "";
      const rarity = RARITY_COLORS[def.rarity] || RARITY_COLORS.common;
      const monthLabel = (b.id.startsWith("goal_met_") || b.id.startsWith("goal_surpassed_"))
        ? ` <span style="font-size:10px;opacity:0.7;">${getBadgeMonthLabel(b.id)}</span>` : "";
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;background:${rarity.bg};border:1.5px solid ${rarity.border};margin-bottom:8px;">
          <span style="font-size:28px;flex-shrink:0;">${def.icon}</span>
          <div>
            <div style="font-family:'Playfair Display',serif;font-size:15px;color:${rarity.text};font-weight:600;">${def.name}${monthLabel}</div>
            <div style="font-size:12px;color:${rarity.text};opacity:0.85;margin-top:2px;">${def.desc}</div>
          </div>
        </div>`;
    }).join("");

    const overlay = document.createElement("div");
    overlay.id    = "badgePopupOverlay";
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(45,27,78,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;">
        <div style="background:var(--aged-paper);border-radius:20px;padding:2rem;max-width:420px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(45,27,78,0.25);text-align:center;">
          <div style="font-size:48px;margin-bottom:0.5rem;">🎉</div>
          <h2 style="font-family:'Playfair Display',serif;font-size:22px;color:var(--deep-plum);margin-bottom:0.25rem;">
            ${unseen.length === 1 ? "You earned a badge!" : `You earned ${unseen.length} badges!`}
          </h2>
          <p style="font-size:13px;color:var(--terracotta);margin-bottom:1.25rem;">Keep up the great reading!</p>
          <div style="text-align:left;margin-bottom:1.25rem;">${badgeItems}</div>
          <button onclick="document.getElementById('badgePopupOverlay').remove()"
            style="font-family:'Nunito Sans',sans-serif;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;border:none;background:var(--amethyst);color:#FAF6EE;cursor:pointer;width:100%;">
            Claim ${unseen.length === 1 ? "Badge" : "Badges"} 🏅
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  } catch (e) {
    console.error("Badge popup error:", e);
  }
}

function buildBadgeGrid(badges) {
  if (!badges.length) return "";

  return badges.map(entry => {
    const def    = getBadgeDef(entry.id);
    if (!def) return "";
    const rarity = RARITY_COLORS[def.rarity] || RARITY_COLORS.common;
    const monthLabel = (entry.id.startsWith("goal_met_") || entry.id.startsWith("goal_surpassed_"))
      ? getBadgeMonthLabel(entry.id) : "";

    return `
      <div style="
        display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 8px;
        border-radius:12px;border:1.5px solid ${rarity.border};
        background:${rarity.bg};text-align:center;">
        <span style="font-size:24px;">${def.icon}</span>
        <span style="font-size:10px;font-weight:700;color:${rarity.text};line-height:1.3;">${def.name}</span>
        <span style="font-size:9px;color:${rarity.text};opacity:0.75;line-height:1.3;">${def.desc}</span>
        ${monthLabel ? `<span style="font-size:9px;color:${rarity.text};opacity:0.6;">${monthLabel}</span>` : ""}
      </div>`;
  }).join("");
}

window.WR = {
  // Auth
  initAuth,
  getCurrentUser: () => _currentUser,
  getDb:          () => _db,
  getAuth:        () => _auth,
  isAdmin:        () => ADMIN_UIDS.includes(_currentUser?.uid),
  signOut,

  // Notifications
  createNotification,

  // Badges
  checkBadges,
  showBadgePopupIfNeeded,
  buildBadgeGrid,
  getBadgeDef,
  BADGE_DEFS,
  RARITY_COLORS,

  // Books
  lookupBook,
  saveBookToDb,
  addBookToUserCollection,
  getUserBook,
  searchGoogleBooks,
  searchGoogleBooksTitle,
  getGoogleBookByISBN,
  getOpenLibraryByISBN,
  normalizeGoogleBook,

  // UI
  showToast,
  renderStars,
  renderStarPicker,
  initStarPicker,
  buildBookCard,
  initCollapsibles,

  // Geocoding (via Radar.io through Cloudflare Worker)
  // Returns { found, results: [{ label, city, state, lat, lng, ... }] }
  geocode: async (query) => callWorker("geocode", { query }),

  // Worker
  callWorker,

  // Utils
  escapeHTML,
  formatRelativeTime,
  formatFullDate,
  formatDateInput,
  generateId,
  getFriendshipId,
  COLORS
};
