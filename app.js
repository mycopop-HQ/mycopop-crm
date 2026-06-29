// Mycopop CRM — application logic (wired to Firebase Auth, Firestore, Functions)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, getIdTokenResult }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs,
  addDoc, query, where, orderBy, limit, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig, functionsRegion } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, functionsRegion);
const call = (name) => httpsCallable(fns, name);

// ---------- tiny helpers ----------
const root = document.getElementById("root");
const $ = (s, p = document) => p.querySelector(s);
const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => (Number(n) || 0).toLocaleString("en-US");
const initials = (s = "") => s.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
function toast(msg, isErr = false) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => t.className = "toast", 2600);
}
async function safe(fn) {
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || "Something went wrong", true); throw e; }
}

// ---------- state ----------
const S = { user: null, role: null, amb: null, config: null, page: null, viewAs: null };
// identity the ambassador screens act on — the logged-in user, or (admin preview) the viewed ambassador
const actorUid = () => S.viewAs?.uid || S.user.uid;

// ============================================================
// AUTH GATE
// ============================================================
onAuthStateChanged(auth, async (user) => {
  try {
    S.user = user;
    if (!user) return renderAuth();
    const token = await getIdTokenResult(user, true);
    S.role = token.claims.role || null;
    if (!S.role) return renderPending();
    S.config = (await getDoc(doc(db, "config/settings"))).data() || null;
    if (S.role === "ambassador") {
      S.amb = (await getDoc(doc(db, "ambassadors", user.uid))).data() || null;
    }
    S.page = S.role === "admin" ? "overview" : "amb-dash";
    renderApp();
  } catch (e) {
    console.error("Post-login load failed:", e);
    renderFatal(e);
  }
});

function renderFatal(e) {
  const msg = (e && (e.message || e.code)) || String(e);
  root.innerHTML = `
  <div class="auth"><div class="authcard">
    <h1>Couldn't load</h1>
    <p class="sub" style="margin:10px 0 14px">You're signed in, but the app hit an error while loading your data:</p>
    <pre style="white-space:pre-wrap;font-size:12px;color:#b00;background:#fff5f5;padding:10px;border-radius:8px">${msg}</pre>
    <button id="retry" class="btn pri" style="width:100%;justify-content:center;margin-top:14px">Retry</button>
    <button id="out" class="btn" style="width:100%;justify-content:center;margin-top:8px">Sign out</button>
  </div></div>`;
  $("#retry").onclick = () => location.reload();
  $("#out").onclick = () => signOut(auth);
}

function renderAuth() {
  root.innerHTML = `
  <div class="auth"><div class="authcard">
    <h1>Mycopop</h1><p class="sub">Ops &amp; Field CRM</p>
    <label class="f">Email</label><input id="email" class="in" type="email" autocomplete="email">
    <label class="f">Password</label>
    <div style="position:relative">
      <input id="pw" class="in" type="password" autocomplete="current-password" style="width:100%;padding-right:62px">
      <button id="pwtoggle" type="button" aria-label="Show password"
        style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.03em;color:#7a7a7a;padding:6px 8px">SHOW</button>
    </div>
    <button id="login" class="btn pri" style="width:100%;justify-content:center;margin-top:16px">Sign in</button>
    <button id="signup" class="btn" style="width:100%;justify-content:center;margin-top:8px">Create account</button>
    <p id="autherr" style="color:#c0392b;font-size:13px;min-height:1.1em;margin-top:12px;text-align:center"></p>
    <p class="sub" style="margin-top:4px;text-align:center">New accounts have no access until an admin assigns a role.</p>
  </div></div>`;
  const pw = $("#pw"), tgl = $("#pwtoggle");
  tgl.onclick = () => {
    const reveal = pw.type === "password";
    pw.type = reveal ? "text" : "password";
    tgl.textContent = reveal ? "HIDE" : "SHOW";
    pw.focus();
  };
  const authError = (e) => {
    const code = (e && e.code || "").replace("auth/", "");
    if (["invalid-credential", "wrong-password", "user-not-found", "invalid-email"].includes(code))
      return "Wrong email or password.";
    if (code === "unauthorized-domain") return "This site's domain isn't authorized in Firebase Auth.";
    if (code === "too-many-requests") return "Too many attempts — wait a minute and try again.";
    if (code === "network-request-failed") return "Network error — check your connection.";
    return (e && e.message) || "Sign-in failed.";
  };
  const err = () => $("#autherr");
  const submit = async () => {
    err().style.color = "#777"; err().textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, $("#email").value.trim(), pw.value);
      err().textContent = "Signed in — loading…";
    } catch (e) { console.error(e); err().style.color = "#c0392b"; err().textContent = authError(e); }
  };
  $("#login").onclick = submit;
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("#email").addEventListener("keydown", (e) => { if (e.key === "Enter") pw.focus(); });
  $("#signup").onclick = async () => {
    err().style.color = "#777"; err().textContent = "Creating account…";
    try {
      await createUserWithEmailAndPassword(auth, $("#email").value.trim(), pw.value);
      err().style.color = "#2a7"; err().textContent = "Account created. Ask an admin to grant access.";
    } catch (e) { console.error(e); err().style.color = "#c0392b"; err().textContent = authError(e); }
  };
}

function renderPending() {
  root.innerHTML = `
  <div class="auth"><div class="authcard">
    <h1>Almost there</h1>
    <p class="sub" style="margin:10px 0 18px">Your account exists but hasn't been given a role yet. An admin needs to add you. Your user ID:</p>
    <div class="efield" style="width:100%"><input class="mono" style="width:100%" readonly value="${S.user.uid}"></div>
    <button id="out" class="btn" style="width:100%;justify-content:center;margin-top:16px">Sign out</button>
  </div></div>`;
  $("#out").onclick = () => signOut(auth);
}

// ============================================================
// APP SHELL
// ============================================================
const ADMIN_NAV = [
  ["overview", "Overview"], ["batches", "Batches &amp; pricing"], ["inventory", "Inventory &amp; nodes"],
  ["ambassadors", "Ambassadors"], ["direct", "Direct sale"], ["orders", "Orders"], ["cashouts", "Cash-outs"], ["viewas", "View as…"], ["settings", "Settings &amp; rules"],
];
const AMB_NAV = [
  ["amb-dash", "My dashboard"], ["amb-order", "Place order"], ["amb-buy", "Buy &amp; convert"], ["amb-wallet", "Wallet"],
];

function renderApp() {
  const preview = !!S.viewAs;
  const role = preview ? "ambassador" : S.role;   // admin previewing renders the ambassador view
  const who = preview ? S.viewAs : S.amb;
  const nav = role === "admin" ? ADMIN_NAV : AMB_NAV;
  const name = role === "admin" ? (S.user.email || "Admin") : (who?.name || S.user.email);
  const sub = role === "admin" ? "Founder · full access"
    : `${who?.title ? who.title : (who?.tier === 2 ? "Founders Tier" : "Tier 1")} · ${who?.tier === 2 ? "20%" : "15%"}`;
  root.innerHTML = `
  <div class="app">
    <aside class="side">
      <div class="brand">
        <svg class="logo" viewBox="0 0 40 40" fill="none"><path d="M20 5C12 5 6 11 6 18c0 2 1 3 3 3h22c2 0 3-1 3-3 0-7-6-13-14-13z" fill="#E0922B"/><circle cx="14" cy="15" r="2" fill="#FBF4F0"/><circle cx="24" cy="13" r="2.4" fill="#FBF4F0"/><path d="M16 21h8l-1 11c0 2-2 3-3 3s-3-1-3-3l-1-11z" fill="#D6435A"/></svg>
        <div><b>Mycopop</b><small>${role === "admin" ? "Command" : "My field"}</small></div>
      </div>
      <nav class="nav" id="nav">
        ${nav.map(([k, label]) => `<button data-page="${k}" class="${k === S.page ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <div class="foot">v1 · ${S.user.email}<br>${preview ? `<button id="exitview">← Exit preview</button>` : `<button id="signout">Sign out</button>`}</div>
    </aside>
    <div class="main">
      ${preview ? `<div style="background:#241B22;color:#fff;padding:9px 18px;font-size:13px;display:flex;justify-content:space-between;align-items:center">
        <span>👁 Viewing as <b>${S.viewAs.name}</b> — read-only preview</span>
        <button id="exitview2" class="btn sm" style="background:#fff;color:#241B22">Exit to admin</button></div>` : ""}
      <div class="top">
        <div class="crumb"><b>${role === "admin" ? "Admin" : "Ambassador"}</b> · <span id="crumb"></span></div>
        <div class="spacer"></div>
        <div class="who"><div class="ava">${initials(name)}</div><div><b>${name}</b><small>${sub}</small></div></div>
      </div>
      <div class="wrap" id="view"></div>
    </div>
  </div>`;
  $("#nav").onclick = (e) => {
    const b = e.target.closest("button[data-page]"); if (!b) return;
    S.page = b.dataset.page;
    $("#nav").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
    route();
  };
  const exitPreview = () => { S.viewAs = null; S.page = "viewas"; renderApp(); };
  if ($("#signout")) $("#signout").onclick = () => signOut(auth);
  if ($("#exitview")) $("#exitview").onclick = exitPreview;
  if ($("#exitview2")) $("#exitview2").onclick = exitPreview;
  route();
}

async function route() {
  const v = $("#view");
  const label = [...ADMIN_NAV, ...AMB_NAV].find(([k]) => k === S.page)?.[1].replace(/&amp;/g, "&") || "";
  $("#crumb").textContent = label;
  v.innerHTML = `<p class="sub">Loading…</p>`;
  const map = {
    overview: adminOverview, batches: adminBatches, inventory: adminInventory,
    ambassadors: adminAmbassadors, direct: adminDirectSale, viewas: adminViewAs, orders: adminOrders, cashouts: adminCashouts, settings: adminSettings,
    "amb-dash": ambDash, "amb-order": ambOrder, "amb-buy": ambBuy, "amb-wallet": ambWallet,
  };
  try {
    await (map[S.page] || (() => v.innerHTML = "Not found"))(v);
  } catch (e) {
    console.error("Screen failed:", S.page, e);
    v.innerHTML = `<div class="card pad"><h3>Couldn't load this screen</h3>
      <p class="sub" style="margin-top:6px">${(e && (e.message || e.code)) || e}</p></div>`;
  }
}

// ---------- shared data loaders ----------
const allDocs = async (col) => (await getDocs(collection(db, col))).docs.map(d => ({ id: d.id, ...d.data() }));

// ============================================================
// ADMIN SCREENS
// ============================================================
async function adminOverview(v) {
  const [orders, ambs, lots, batches, cashouts] = await Promise.all([
    allDocs("orders"), allDocs("ambassadors"), allDocs("stockLots"), allDocs("batches"), allDocs("cashoutRequests"),
  ]);
  const sales = orders.filter(o => o.type === "consignment_sale");
  const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const cans = orders.reduce((s, o) => s + (o.cans || 0), 0);
  const owed = ambs.reduce((s, a) => s + (a.walletAvailable || 0), 0);
  const pendingCashouts = cashouts.filter(c => c.status === "pending");

  v.innerHTML = `
    <div class="pagehead"><div><h1>Overview</h1><p>Live snapshot across all batches, nodes and ambassadors.</p></div>
      ${batches.length === 0 ? `<button id="seed" class="btn pri">Seed demo data</button>` : ""}</div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--saffron)"></span>Revenue (all)</div><div class="val mono">${money(revenue)}</div></div>
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--berry)"></span>Cans moved</div><div class="val mono">${num(cans)}</div></div>
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--myc)"></span>Credit-wallet liability</div><div class="val mono">${money(owed)}</div></div>
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--ink)"></span>Pending cash-outs</div><div class="val mono">${pendingCashouts.length}</div></div>
    </div>
    <div class="card"><div class="ch"><h3>Recent activity</h3><span class="sub">${orders.length} orders</span></div>
      <table><thead><tr><th>Type</th><th>Ambassador</th><th>Cans</th><th>Per can</th><th>Total</th></tr></thead><tbody>
        ${orders.slice(-12).reverse().map(o => `<tr>
          <td>${typePill(o.type)}</td>
          <td>${ambName(ambs, o.ambassadorId)}</td>
          <td class="mono">${num(o.cans)}</td>
          <td class="mono">${money(o.perCanPrice)}</td>
          <td class="mono">${money(o.total)}</td></tr>`).join("") || `<tr><td colspan="5" class="sub">No orders yet.</td></tr>`}
      </tbody></table></div>`;
  if ($("#seed")) $("#seed").onclick = () => safe(async () => {
    await call("seedData")(); toast("Demo data seeded"); route();
  });
}

async function adminBatches(v) {
  const batches = await allDocs("batches");
  const spread = S.config?.creditSpread ?? 0.5;
  v.innerHTML = `
    <div class="pagehead"><div><h1>Batches &amp; pricing</h1><p>Credit price re-derives from wholesale − the $${spread.toFixed(2)} spread every time you save.</p></div>
      <button id="new" class="btn pri">+ New batch</button></div>
    <div id="blist" class="grid" style="gap:18px">
      ${batches.map(b => batchCard(b, spread)).join("") || `<div class="card pad sub">No batches yet — use “Seed demo data” on the Overview, or add one here.</div>`}
    </div>`;
  $("#new").onclick = () => openBatchEditor(null, spread);
  v.querySelectorAll("[data-edit]").forEach(btn =>
    btn.onclick = () => openBatchEditor(batches.find(b => b.id === btn.dataset.edit), spread));
}

function batchCard(b, spread) {
  const cost = b.costPerCan || 0, ws = b.wholesalePrice || 0;
  const owned = b.ownedPrice ?? ws;
  const credit = b.creditPrice ?? Math.max(0, owned - spread);
  const comm = ws * 0.175;
  return `<div class="card"><div class="ch"><div><h3>${b.code}</h3>
      <span class="sub">${num(b.cansProduced)} cans · best-by ${b.bestBy || "—"}</span></div>
      <button class="btn sm" data-edit="${b.id}">Edit</button></div>
    <div class="pad" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      <div><div class="lock">Cost/can</div><div class="mono" style="font-size:18px;font-weight:600">${money(cost)}</div></div>
      <div><div class="lock">Consignment</div><div class="mono" style="font-size:18px;font-weight:600">${money(ws)}</div></div>
      <div><div class="lock">Buy-to-own</div><div class="mono" style="font-size:18px;font-weight:600">${money(owned)}</div></div>
      <div><div class="lock">Credit <span class="auto">↺ auto</span></div><div class="mono" style="font-size:18px;font-weight:600;color:var(--saffron-d)">${money(credit)}</div></div>
    </div>
    <div class="pad" style="border-top:1px solid var(--line);font-size:12px;color:var(--ink-2)">
      Your net/can — consignment ${money(ws - cost - comm)} · buy-to-own ${money(owned - cost)} · credit buy ${money(credit - cost)}</div></div>`;
}

function openBatchEditor(b, spread) {
  const v = $("#view");
  const d = b || { code: "", costPerCan: 1.83, wholesalePrice: 4, ownedPrice: 3.5, cansProduced: 0, bbl: null, bestBy: "", cannedDate: "", productId: "mycopop-hgl" };
  const ownedVal = (d.ownedPrice ?? d.wholesalePrice);
  v.innerHTML = `<div class="pagehead"><div><h1>${b ? "Edit batch" : "New batch"}</h1>
      <p>Consignment is the sell price; buy-to-own is the stock-it price. Credit = buy-to-own − $${spread.toFixed(2)}.</p></div>
      <button id="back" class="btn">← Back</button></div>
    <div class="card pad" style="max-width:560px">
      <label class="f">Batch code</label><input id="code" class="in" value="${d.code}">
      <div class="grid g2"><div><label class="f">Cost / can</label><input id="cost" class="in mono" type="number" step="0.01" value="${d.costPerCan}"></div>
        <div><label class="f">Consignment / can</label><input id="ws" class="in mono" type="number" step="0.01" value="${d.wholesalePrice}"></div></div>
      <div class="grid g2" style="margin-top:4px"><div><label class="f">Buy-to-own / can</label><input id="owned" class="in mono" type="number" step="0.01" value="${ownedVal}"></div>
        <div><label class="f">Credit price <span class="auto">auto = buy-to-own − $${spread.toFixed(2)}</span></label><input id="credit" class="in mono" readonly value="${Math.max(0, ownedVal - spread).toFixed(2)}"></div></div>
      <div class="grid g2" style="margin-top:4px"><div><label class="f">Cans produced</label><input id="cans" class="in mono" type="number" value="${d.cansProduced}"></div>
        <div><label class="f">Canned date</label><input id="canned" class="in" type="date" value="${d.cannedDate||""}"></div></div>
      <div class="grid g2" style="margin-top:4px"><div><label class="f">Best-by</label><input id="bestby" class="in" type="date" value="${d.bestBy||""}"></div><div></div></div>
      <button id="save" class="btn pri" style="margin-top:18px;width:100%;justify-content:center">${b ? "Save changes" : "Create batch"}</button>
    </div>`;
  $("#back").onclick = route;
  $("#owned").oninput = () => $("#credit").value = Math.max(0, (parseFloat($("#owned").value) || 0) - spread).toFixed(2);
  $("#save").onclick = () => safe(async () => {
    await call("saveBatch")({ batchId: b?.id || $("#code").value.trim(), data: {
      productId: d.productId, code: $("#code").value.trim(),
      costPerCan: parseFloat($("#cost").value), wholesalePrice: parseFloat($("#ws").value),
      ownedPrice: parseFloat($("#owned").value),
      cansProduced: parseInt($("#cans").value) || 0, bbl: d.bbl,
      cannedDate: $("#canned").value, bestBy: $("#bestby").value, status: "active",
    }});
    toast("Batch saved — pricing updated"); S.page = "batches"; route();
  });
}

async function adminInventory(v) {
  const [lots, nodes, ambs] = await Promise.all([allDocs("stockLots"), allDocs("nodes"), allDocs("ambassadors")]);
  const central = lots.filter(l => l.location === "central").reduce((s, l) => s + l.quantity, 0);
  const con = lots.filter(l => l.ownership === "consignment" && l.location !== "central").reduce((s, l) => s + l.quantity, 0);
  const own = lots.filter(l => l.ownership === "owned").reduce((s, l) => s + l.quantity, 0);
  v.innerHTML = `
    <div class="pagehead"><div><h1>Inventory &amp; nodes</h1><p>Every can by node and ownership pool.</p></div></div>
    <div class="grid g3" style="margin-bottom:18px">
      <div class="card pad kpi"><div class="lab">Central warehouse</div><div class="val mono">${num(central)}</div></div>
      <div class="card pad kpi"><div class="lab">At nodes · consignment</div><div class="val mono">${num(con)}</div></div>
      <div class="card pad kpi"><div class="lab">At nodes · owned</div><div class="val mono">${num(own)}</div></div>
    </div>
    <div class="grid g3">
      ${nodes.map(n => {
        const c = lots.filter(l => l.nodeId === n.id && l.ownership === "consignment").reduce((s, l) => s + l.quantity, 0);
        const o = lots.filter(l => l.nodeId === n.id && l.ownership === "owned").reduce((s, l) => s + l.quantity, 0);
        return `<div class="card pad"><h3 style="font-size:14px">${n.name}</h3><div class="sub">${n.location || ""}</div>
          <div style="display:flex;justify-content:space-between;margin-top:12px"><span class="pill con">Consignment</span><b class="mono">${num(c)}</b></div>
          <div style="display:flex;justify-content:space-between;margin-top:10px"><span class="pill own">Owned</span><b class="mono">${num(o)}</b></div></div>`;
      }).join("") || `<div class="card pad sub">No nodes yet.</div>`}
    </div>`;
}

async function adminAmbassadors(v) {
  const [ambs, nodes] = await Promise.all([allDocs("ambassadors"), allDocs("nodes")]);
  v.innerHTML = `
    <div class="pagehead"><div><h1>Ambassadors</h1><p>Tier sets the commission rate (edit in Settings). Add someone by their user ID after they sign up.</p></div>
      <button id="add" class="btn pri">+ Add ambassador</button></div>
    <div class="card"><div class="ch"><h3>Roster</h3></div>
      <table><thead><tr><th>Name</th><th>Tier</th><th>Node</th><th>Available credit</th><th>Lifetime earned</th></tr></thead><tbody>
        ${ambs.map(a => `<tr><td><span class="av-sm">${initials(a.name)}</span><span class="nm">${a.name||"—"}</span>${a.title ? ` <span class="pill" style="background:var(--ink,#241B22);color:#fff">${a.title}</span>` : ""}<div class="sub">${a.email||""}</div></td>
          <td>${a.commissionRate === 0 ? '<span class="pill">House · 0%</span>' : a.tier === 2 ? '<span class="pill t20">Founders · 20%</span>' : '<span class="pill t15">15%</span>'}</td>
          <td>${nodes.find(n => n.id === a.nodeId)?.name || a.nodeId || "—"}</td>
          <td class="mono" style="color:var(--myc-d)">${money(a.walletAvailable)}</td>
          <td class="mono">${money(a.walletEarnedLifetime)}</td></tr>`).join("") || `<tr><td colspan="5" class="sub">No ambassadors yet.</td></tr>`}
      </tbody></table></div>`;
  $("#add").onclick = () => openAmbEditor(nodes);
}

function openAmbEditor(nodes) {
  const v = $("#view");
  v.innerHTML = `<div class="pagehead"><div><h1>Add ambassador</h1>
    <p>They must create an account first; paste their user ID from the “Almost there” screen.</p></div>
    <button id="back" class="btn">← Back</button></div>
    <div class="card pad" style="max-width:520px">
      <label class="f">User ID (uid)</label><input id="uid" class="in mono">
      <label class="f">Name</label><input id="name" class="in">
      <label class="f">Email</label><input id="email" class="in" type="email">
      <div class="grid g2"><div><label class="f">Tier</label><select id="tier" class="in"><option value="1">Tier 1 · 15%</option><option value="2">Founders Tier · 20%</option></select></div>
        <div><label class="f">Node</label><select id="node" class="in">${nodes.map(n => `<option value="${n.id}">${n.name}</option>`).join("")}</select></div></div>
      <button id="save" class="btn pri" style="margin-top:18px;width:100%;justify-content:center">Create &amp; grant access</button>
    </div>`;
  $("#back").onclick = route;
  $("#save").onclick = () => safe(async () => {
    const uid = $("#uid").value.trim();
    if (!uid) return toast("Enter the user's uid", true);
    await setDoc(doc(db, "ambassadors", uid), {
      uid, name: $("#name").value.trim(), email: $("#email").value.trim(),
      tier: parseInt($("#tier").value), nodeId: $("#node").value, status: "active",
      salesGoal: 0, walletAvailable: 0, walletPending: 0, walletSpent: 0,
      walletCashedOut: 0, walletEarnedLifetime: 0,
    }, { merge: true });
    await call("setUserRole")({ uid, role: "ambassador" });
    toast("Ambassador added"); S.page = "ambassadors"; route();
  });
}

async function adminViewAs(v) {
  const ambs = (await allDocs("ambassadors")).filter(a => a.id !== "house");
  v.innerHTML = `<div class="pagehead"><div><h1>View as ambassador</h1><p>Open any ambassador's dashboard exactly as they see it — read-only.</p></div></div>
    <div class="card"><div class="ch"><h3>Choose an ambassador</h3></div>
      <table><thead><tr><th>Name</th><th>Tier</th><th>Node</th><th></th></tr></thead><tbody>
        ${ambs.map(a => `<tr><td><span class="av-sm">${initials(a.name)}</span>${a.name || "—"}${a.title ? ` <span class="pill" style="background:var(--ink,#241B22);color:#fff">${a.title}</span>` : ""}</td>
          <td>${a.tier === 2 ? '<span class="pill t20">20%</span>' : '<span class="pill t15">15%</span>'}</td>
          <td>${a.nodeId || "—"}</td>
          <td><button class="btn sm" data-view="${a.id}">Preview →</button></td></tr>`).join("") || `<tr><td colspan="4" class="sub">No ambassadors yet.</td></tr>`}
      </tbody></table></div>`;
  v.querySelectorAll("[data-view]").forEach(btn => btn.onclick = () => {
    S.viewAs = ambs.find(a => a.id === btn.dataset.view);
    S.page = "amb-dash"; renderApp();
  });
}

async function adminDirectSale(v) {
  const [batches, lots, nodes, custs] = await Promise.all([
    allDocs("batches"), allDocs("stockLots"), allDocs("nodes"),
    getDocs(query(collection(db, "customers"), where("ambassadorId", "==", "house"))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
  ]);
  const avail = (node, batch) => lots.filter(l => l.nodeId === node && l.batchId === batch && l.ownership === "consignment").reduce((s, l) => s + l.quantity, 0);
  v.innerHTML = `<div class="pagehead"><div><h1>Direct sale <span class="pill" style="vertical-align:middle">House · 0%</span></h1>
      <p>Fungus Ranch sells directly — full margin, no field commission. Draws from the node's consignment stock you choose.</p></div></div>
    <div class="card pad" style="max-width:540px">
      <label class="f">Sell from node</label><select id="node" class="in">${nodes.map(n => `<option value="${n.id}">${n.name}</option>`).join("")}</select>
      <label class="f">Batch</label><select id="batch" class="in">${batches.map(b => `<option value="${b.id}" data-ws="${b.wholesalePrice}" data-cost="${b.costPerCan}">${b.code} · ${money(b.wholesalePrice)}/can</option>`).join("")}</select>
      <div class="sub" id="avail" style="margin:4px 0 8px"></div>
      <label class="f">Customer (optional)</label><input id="cust" class="in" placeholder="e.g. Whole Foods SE" list="cl"><datalist id="cl">${custs.map(c => `<option value="${c.name}">`).join("")}</datalist>
      <label class="f">Cans</label><input id="cans" class="in mono" type="number" value="24">
      <div style="display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid var(--line);margin-top:14px"><span>Order value</span><b class="mono" id="val">—</b></div>
      <div style="display:flex;justify-content:space-between;padding-bottom:4px"><span>Commission</span><b class="mono">$0.00 · House</b></div>
      <div style="display:flex;justify-content:space-between;padding-bottom:12px"><span style="color:var(--myc-d)">Margin (rev − cost)</span><b class="mono" id="marg" style="color:var(--myc-d)">—</b></div>
      <button id="submit" class="btn pri" style="width:100%;justify-content:center">Record direct sale</button>
    </div>`;
  const sel = () => $("#batch").selectedOptions[0];
  const recalc = () => {
    const ws = parseFloat(sel()?.dataset.ws) || 0, cost = parseFloat(sel()?.dataset.cost) || 0;
    const cans = parseInt($("#cans").value) || 0, node = $("#node").value, batch = $("#batch").value;
    $("#val").textContent = money(ws * cans);
    $("#marg").textContent = money((ws - cost) * cans);
    $("#avail").textContent = `${num(avail(node, batch))} cans available in ${nodes.find(n => n.id === node)?.name || node}`;
  };
  ["#node", "#batch"].forEach(s => $(s).onchange = recalc); $("#cans").oninput = recalc; recalc();
  $("#submit").onclick = () => safe(async () => {
    let customerId = null; const name = $("#cust").value.trim();
    if (name) {
      const ex = custs.find(c => c.name.toLowerCase() === name.toLowerCase());
      customerId = ex ? ex.id : (await addDoc(collection(db, "customers"), { name, type: "account", ambassadorId: "house" })).id;
    }
    const r = await call("createConsignmentSale")({ batchId: $("#batch").value, cans: parseInt($("#cans").value), customerId, ambassadorId: "house", sourceNodeId: $("#node").value });
    toast(`Direct sale recorded — ${money(r.data.total)}`); S.page = "orders"; route();
  });
}

async function adminOrders(v) {
  const [orders, ambs] = await Promise.all([allDocs("orders"), allDocs("ambassadors")]);
  v.innerHTML = `<div class="pagehead"><div><h1>Orders</h1><p>All transaction types in one queue.</p></div></div>
    <div class="card"><table><thead><tr><th>Type</th><th>Pay</th><th>Ambassador</th><th>Batch</th><th>Cans</th><th>Per can</th><th>Total</th><th>Commission</th></tr></thead><tbody>
      ${orders.slice().reverse().map(o => `<tr><td>${typePill(o.type)}</td><td>${o.paymentMethod==="na"?"—":o.paymentMethod}</td>
        <td>${ambName(ambs, o.ambassadorId)}</td><td class="mono">${o.batchId}</td><td class="mono">${num(o.cans)}</td>
        <td class="mono">${money(o.perCanPrice)}</td><td class="mono">${money(o.total)}</td>
        <td class="mono" style="color:var(--myc-d)">${o.commissionAmount?money(o.commissionAmount):"—"}</td></tr>`).join("")
        || `<tr><td colspan="8" class="sub">No orders yet.</td></tr>`}
    </tbody></table></div>`;
}

async function adminCashouts(v) {
  const [reqs, ambs] = await Promise.all([allDocs("cashoutRequests"), allDocs("ambassadors")]);
  const pending = reqs.filter(r => r.status === "pending");
  v.innerHTML = `<div class="pagehead"><div><h1>Cash-outs</h1><p>Approve to debit the wallet and record it in the ledger.</p></div></div>
    <div class="card"><div class="ch"><h3>Requests</h3></div>
      <table><thead><tr><th>Ambassador</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
        ${reqs.slice().reverse().map(r => `<tr><td>${ambName(ambs, r.ambassadorId)}</td><td class="mono">${money(r.amount)}</td>
          <td><span class="pill ${r.status==="paid"?"con":"tr"}">${r.status}</span></td>
          <td>${r.status==="pending"?`<button class="btn sm" data-approve="${r.id}">Approve</button>`:""}</td></tr>`).join("")
          || `<tr><td colspan="4" class="sub">No requests.</td></tr>`}
      </tbody></table></div>`;
  v.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => safe(async () => {
    await call("approveCashout")({ requestId: b.dataset.approve }); toast("Cash-out approved"); route();
  }));
}

async function adminSettings(v) {
  const c = S.config || {};
  v.innerHTML = `<div class="pagehead"><div><h1>Settings &amp; rules</h1><p>Change a rule here and it applies everywhere — nothing is hardcoded.</p></div>
      <button id="save" class="btn pri">Save changes</button></div>
    <div class="grid g2">
      <div class="card pad"><h3 style="font-size:14px;margin-bottom:12px">Commission tiers</h3>
        <label class="f">Tier 1 rate (%)</label><input id="t1" class="in mono" type="number" step="1" value="${(c.tier1Rate??.15)*100}">
        <label class="f">Tier 2 rate (%)</label><input id="t2" class="in mono" type="number" step="1" value="${(c.tier2Rate??.20)*100}"></div>
      <div class="card pad"><h3 style="font-size:14px;margin-bottom:12px">Pricing rules</h3>
        <label class="f">Credit spread off wholesale ($)</label><input id="spread" class="in mono" type="number" step="0.05" value="${c.creditSpread??.5}">
        <label class="f">Minimum margin floor / can ($)</label><input id="floor" class="in mono" type="number" step="0.05" value="${c.minMarginFloor??1}">
        <p class="sub" style="margin-top:8px">Cash buy price always equals wholesale.</p></div>
      <div class="card pad"><h3 style="font-size:14px;margin-bottom:12px">Cash-out rules</h3>
        <label class="f">Allow cash-out</label><select id="cashon" class="in"><option value="true" ${c.cashOutEnabled!==false?"selected":""}>On</option><option value="false" ${c.cashOutEnabled===false?"selected":""}>Off</option></select>
        <label class="f">Minimum cash-out ($)</label><input id="cashmin" class="in mono" type="number" value="${c.cashOutMin??100}"></div>
      <div class="card pad"><h3 style="font-size:14px;margin-bottom:12px">Pallet &amp; conversion</h3>
        <label class="f">Cans per pallet</label><input id="pallet" class="in mono" type="number" value="${c.cansPerPallet??1200}">
        <label class="f">Allow consignment → owned</label><select id="conv" class="in"><option value="true" ${c.allowConversion!==false?"selected":""}>On</option><option value="false" ${c.allowConversion===false?"selected":""}>Off</option></select></div>
    </div>`;
  $("#save").onclick = () => safe(async () => {
    const next = {
      tier1Rate: (parseFloat($("#t1").value) || 0) / 100, tier2Rate: (parseFloat($("#t2").value) || 0) / 100,
      creditSpread: parseFloat($("#spread").value) || 0, minMarginFloor: parseFloat($("#floor").value) || 0,
      cashOutEnabled: $("#cashon").value === "true", cashOutMin: parseFloat($("#cashmin").value) || 0,
      cansPerPallet: parseInt($("#pallet").value) || 0, allowConversion: $("#conv").value === "true",
    };
    await setDoc(doc(db, "config/settings"), next, { merge: true });
    S.config = { ...c, ...next }; toast("Settings saved");
  });
}

// ============================================================
// AMBASSADOR SCREENS
// ============================================================
async function loadAmb() { S.amb = (await getDoc(doc(db, "ambassadors", actorUid()))).data() || {}; }
async function myLots() {
  return (await allDocs("stockLots")).filter(l =>
    (l.ownership === "consignment" && l.nodeId === S.amb.nodeId) ||
    (l.ownership === "owned" && l.ownerAmbassadorId === actorUid()));
}

async function ambDash(v) {
  await loadAmb();
  const [orders, lots] = await Promise.all([
    getDocs(query(collection(db, "orders"), where("ambassadorId", "==", actorUid()))).then(s => s.docs.map(d => d.data())),
    myLots(),
  ]);
  const sales = orders.filter(o => o.type === "consignment_sale");
  const con = lots.filter(l => l.ownership === "consignment").reduce((s, l) => s + l.quantity, 0);
  const own = lots.filter(l => l.ownership === "owned").reduce((s, l) => s + l.quantity, 0);
  const a = S.amb;
  v.innerHTML = `<div class="pagehead"><div><h1>Hi ${a.name?.split(" ")[0] || ""} 👋</h1><p>Your numbers, live.</p></div></div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--saffron)"></span>My sales</div><div class="val mono">${money(sales.reduce((s,o)=>s+(o.total||0),0))}</div></div>
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--myc)"></span>Available credit</div><div class="val mono" style="color:var(--myc-d)">${money(a.walletAvailable)}</div></div>
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--berry)"></span>Lifetime earned</div><div class="val mono">${money(a.walletEarnedLifetime)}</div></div>
      <div class="card pad kpi"><div class="lab"><span class="dotk" style="background:var(--ink)"></span>My stock</div><div class="val mono">${num(con+own)}</div></div>
    </div>
    <div class="grid g2">
      <div class="card pad"><h3 style="font-size:14px;margin-bottom:6px">My inventory</h3>
        <div style="display:flex;justify-content:space-between;margin-top:10px"><span class="pill con">Consignment · earn commission</span><b class="mono" style="font-size:18px">${num(con)}</b></div>
        <div style="display:flex;justify-content:space-between;margin-top:12px"><span class="pill own">Owned · keep retail</span><b class="mono" style="font-size:18px">${num(own)}</b></div></div>
      <div class="card pad"><h3 style="font-size:14px;margin-bottom:10px">Quick actions</h3>
        <button class="btn berry" style="width:100%;justify-content:center;margin-bottom:8px" onclick="">Use “Place order” to sell</button>
        <p class="sub">Sell from consignment to earn commission, or buy stock to own at a discount with your credit.</p></div>
    </div>`;
}

async function ambOrder(v) {
  await loadAmb();
  const [batches, customers] = await Promise.all([allDocs("batches"), 
    getDocs(query(collection(db, "customers"), where("ambassadorId", "==", S.user.uid))).then(s => s.docs.map(d => ({id:d.id,...d.data()})))]);
  const rate = S.amb.tier === 2 ? (S.config?.tier2Rate ?? .2) : (S.config?.tier1Rate ?? .15);
  v.innerHTML = `<div class="pagehead"><div><h1>Place order</h1><p>Sell consignment stock and earn ${(rate*100).toFixed(0)}% commission.</p></div></div>
    <div class="card pad" style="max-width:520px">
      <label class="f">Customer name</label><input id="cust" class="in" placeholder="e.g. Lowland Cafe" list="custlist">
      <datalist id="custlist">${customers.map(c=>`<option value="${c.name}">`).join("")}</datalist>
      <label class="f">Batch</label><select id="batch" class="in">${batches.map(b=>`<option value="${b.id}" data-ws="${b.wholesalePrice}">${b.code} · ${money(b.wholesalePrice)}/can</option>`).join("")}</select>
      <label class="f">Cans</label><input id="cans" class="in mono" type="number" value="24">
      <div style="display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid var(--line);margin-top:14px"><span>Order value</span><b class="mono" id="val">—</b></div>
      <div style="display:flex;justify-content:space-between;padding-bottom:14px"><span style="color:var(--myc-d)">Your commission (${(rate*100).toFixed(0)}%)</span><b class="mono" id="comm" style="color:var(--myc-d)">—</b></div>
      <button id="submit" class="btn berry" style="width:100%;justify-content:center">Submit order</button>
    </div>`;
  const recalc = () => {
    const ws = parseFloat($("#batch").selectedOptions[0]?.dataset.ws) || 0;
    const cans = parseInt($("#cans").value) || 0;
    $("#val").textContent = money(ws * cans); $("#comm").textContent = money(ws * cans * rate);
  };
  $("#batch").onchange = recalc; $("#cans").oninput = recalc; recalc();
  $("#submit").onclick = () => safe(async () => {
    if (S.viewAs) return toast("Read-only preview — exit to transact", true);
    let customerId = null;
    const name = $("#cust").value.trim();
    if (name) {
      const existing = customers.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (existing) customerId = existing.id;
      else customerId = (await addDoc(collection(db, "customers"), { name, type: "account", ambassadorId: actorUid() })).id;
    }
    const r = await call("createConsignmentSale")({ batchId: $("#batch").value, cans: parseInt($("#cans").value), customerId });
    toast(`Sold — you earned ${money(r.data.commission)}`); route();
  });
}

async function ambBuy(v) {
  await loadAmb();
  const batches = await allDocs("batches");
  const lots = await myLots();
  v.innerHTML = `<div class="pagehead"><div><h1>Buy &amp; convert</h1><p>Credit unlocks the discount; cash is full wholesale.</p></div></div>
    <div class="card pad" style="max-width:560px;margin-bottom:18px">
      <label class="f">Batch</label><select id="batch" class="in">${batches.map(b=>`<option value="${b.id}" data-ws="${b.wholesalePrice}" data-cr="${b.creditPrice}">${b.code}</option>`).join("")}</select>
      <label class="f">Cans</label><input id="cans" class="in mono" type="number" value="600">
      <div class="grid g2" style="margin-top:16px">
        <div class="card pad" style="border:2px solid var(--saffron)"><div style="display:flex;justify-content:space-between"><b>Credit</b><span class="pill t20">best value</span></div>
          <div class="mono" id="crp" style="font-size:22px;font-weight:600;margin:6px 0"></div>
          <div class="sub">from your $${(S.amb.walletAvailable||0).toFixed(2)} credit</div>
          <button id="buyCredit" class="btn pri" style="width:100%;justify-content:center;margin-top:12px">Buy with credit</button></div>
        <div class="card pad"><b>Cash</b>
          <div class="mono" id="csp" style="font-size:22px;font-weight:600;margin:6px 0"></div>
          <div class="sub">full wholesale, keeps your credit</div>
          <button id="buyCash" class="btn" style="width:100%;justify-content:center;margin-top:12px">Buy with cash</button></div>
      </div>
    </div>
    <div class="card pad" style="max-width:560px"><h3 style="font-size:14px;margin-bottom:10px">Convert consignment → owned</h3>
      <p class="sub" style="margin-bottom:12px">Flip stock you already hold to fully yours, paid from credit at the credit price.</p>
      <label class="f">Cans to convert</label><input id="convCans" class="in mono" type="number" value="144" style="max-width:160px">
      <button id="convert" class="btn berry" style="margin-top:12px">Convert with credit</button></div>`;
  const recalc = () => {
    const o = $("#batch").selectedOptions[0]; const cans = parseInt($("#cans").value) || 0;
    $("#crp").textContent = money((parseFloat(o?.dataset.cr)||0) * cans);
    $("#csp").textContent = money((parseFloat(o?.dataset.ws)||0) * cans);
  };
  $("#batch").onchange = recalc; $("#cans").oninput = recalc; recalc();
  const buy = (method) => safe(async () => {
    if (S.viewAs) return toast("Read-only preview — exit to transact", true);
    await call("buyToOwn")({ batchId: $("#batch").value, cans: parseInt($("#cans").value), paymentMethod: method });
    toast(`Bought with ${method}`); route();
  });
  $("#buyCredit").onclick = () => buy("credit");
  $("#buyCash").onclick = () => buy("cash");
  $("#convert").onclick = () => safe(async () => {
    if (S.viewAs) return toast("Read-only preview — exit to transact", true);
    await call("convertConsignmentToOwned")({ batchId: $("#batch").value, cans: parseInt($("#convCans").value) });
    toast("Converted to owned"); route();
  });
}

async function ambWallet(v) {
  await loadAmb();
  const entries = await getDocs(query(collection(db, "walletEntries"), where("ambassadorId", "==", actorUid())))
    .then(s => s.docs.map(d => d.data()));
  const a = S.amb;
  v.innerHTML = `<div class="pagehead"><div><h1>Wallet</h1><p>Spend earned commission on discounted stock, or cash it out.</p></div></div>
    <div class="grid g2">
      <div class="card pad" style="background:linear-gradient(135deg,#2b1f27,#3a2630);color:#fff">
        <div style="font-family:'Bricolage Grotesque';font-weight:800;font-size:40px">${money(a.walletAvailable)}</div>
        <div style="color:#c9b8c0;font-size:12px;margin-bottom:16px">available to spend</div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(255,255,255,.1)"><span>Lifetime earned</span><b class="mono">${money(a.walletEarnedLifetime)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(255,255,255,.1)"><span>Spent on stock</span><b class="mono">${money(a.walletSpent)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(255,255,255,.1)"><span>Cashed out</span><b class="mono">${money(a.walletCashedOut)}</b></div>
        <div style="display:flex;gap:10px;margin-top:16px"><input id="amt" class="in mono" type="number" placeholder="Amount" style="background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff">
          <button id="cashout" class="btn berry" style="white-space:nowrap">Request cash-out</button></div>
      </div>
      <div class="card"><div class="ch"><h3>History</h3></div><table><tbody>
        ${entries.slice().reverse().map(e => `<tr><td><span class="pill ${e.kind==="earned"?"con":e.kind==="cashed"?"tr":"own"}">${e.kind}</span></td>
          <td class="mono" style="text-align:right;${e.kind==="earned"?"color:var(--myc-d)":""}">${e.kind==="earned"?"+":"−"}${money(e.amount)}</td></tr>`).join("")
          || `<tr><td class="sub">No activity yet.</td></tr>`}
      </tbody></table></div>
    </div>`;
  $("#cashout").onclick = () => safe(async () => {
    if (S.viewAs) return toast("Read-only preview — exit to transact", true);
    await call("requestCashout")({ amount: parseFloat($("#amt").value) });
    toast("Cash-out requested — pending admin approval");
  });
}

// ---------- small render helpers ----------
function typePill(t) {
  const map = { consignment_sale: ["con", "Sale"], credit_buy: ["own", "Credit buy"],
    cash_buy: ["own", "Cash buy"], conversion: ["tr", "Convert"] };
  const [cls, label] = map[t] || ["tr", t];
  return `<span class="pill ${cls}">${label}</span>`;
}
function ambName(ambs, id) {
  const a = ambs.find(x => x.id === id || x.uid === id);
  return a ? `<span class="av-sm">${initials(a.name)}</span>${a.name}` : (id ? id.slice(0, 6) : "—");
}
