"use strict";

const GRAMS_PER_SG = 10; // 1 Standardglas ≈ 10 g reiner Alkohol
const MAX_HOURS = 12;
const DEFAULT_SETTINGS = { start: 19, end: 3 };
const PHASE_LABEL = { early: "🍺 Bier-Start", mid: "📈 Wird stärker", late: "🔥 Vollgas" };

const USERS = window.USERS;
const EMAIL_DOMAIN = window.EMAIL_DOMAIN;

// ---------- State ----------

let db = null;
let auth = null;
let me = null; // User-ID des eingeloggten Accounts
let remote = { settings: { ...DEFAULT_SETTINGS }, custom: {}, hours: {} };
let rootRef = null;
let selectedDrinkId = null;
let activeCat = "all";
let searchTerm = "";
let loginUser = USERS[0].id;
const sugSeeds = {}; // pro Stunde ein Zufallsseed, damit Vorschläge stabil bleiben

// ---------- Helpers ----------

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function duration(start, end) {
  return ((end - start + 24) % 24) || 24;
}

function settings() {
  const s = remote.settings || {};
  const start = Number.isInteger(s.start) ? s.start : DEFAULT_SETTINGS.start;
  let end = Number.isInteger(s.end) ? s.end : DEFAULT_SETTINGS.end;
  if (duration(start, end) > MAX_HOURS) end = (start + 6) % 24;
  return { start, end };
}

function hours() {
  const { start, end } = settings();
  return Array.from({ length: duration(start, end) }, (_, i) => (start + i) % 24);
}

function fmtHour(h) {
  return String(h % 24).padStart(2, "0") + ":00";
}

function fmtNum(n) {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function userById(id) {
  return USERS.find((u) => u.id === id);
}

function allDrinks() {
  return DRINKS.concat(Object.values(remote.custom || {}));
}

function drinkById(id) {
  return allDrinks().find((d) => d.id === id);
}

// Name, Emoji und Standardgläser eines Vorschlags (berücksichtigt das Mischgetränk)
function describe(drinkId, mixer) {
  const d = drinkById(drinkId);
  if (!d) return { name: "Unbekannter Drink", emoji: "❓", sg: 0 };
  if (!d.mix) return { name: d.name, emoji: d.emoji, sg: grams(d.ml, d.abv) / GRAMS_PER_SG };
  const pure = !mixer || mixer === "pur";
  const alcMl = pure ? SHOT_ML : MIX_SPIRIT_ML;
  return {
    name: pure ? `${d.name} pur` : `${d.name} + ${mixer}`,
    emoji: d.emoji,
    sg: grams(alcMl, d.abv) / GRAMS_PER_SG,
  };
}

function grams(ml, abv) {
  return ml * abv / 100 * 0.8;
}

function drinkMeta(d) {
  if (d.mix) return `${fmtNum(d.abv)} % · Mischgetränk wählbar`;
  return `${d.ml} ml · ${fmtNum(d.abv)} % · ${fmtNum(grams(d.ml, d.abv) / GRAMS_PER_SG)} SG`;
}

function proposals(h) {
  const byUser = (remote.hours && remote.hours[h]) || {};
  return USERS.filter((u) => byUser[u.id] && byUser[u.id].drinkId)
    .map((u) => ({ owner: u.id, ...byUser[u.id], votes: byUser[u.id].votes || {} }));
}

function isAgreed(p) {
  return USERS.every((u) => p.votes[u.id] === true);
}

function phaseOf(h) {
  const hs = hours();
  const t = (hs.indexOf(h) + 0.5) / hs.length;
  return t < 0.34 ? "early" : t < 0.67 ? "mid" : "late";
}

// Deterministischer Pseudo-Zufall (seed + key -> 0..1)
function rand(seed, key) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += 0x6d2b79f5;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

function newSeed() {
  return (Math.random() * 2 ** 32) >>> 0;
}

function seedFor(h) {
  if (sugSeeds[h] === undefined) sugSeeds[h] = newSeed();
  return sugSeeds[h];
}

// ---------- Vorschläge pro Phase ----------

function suggest(h, count = 3) {
  const hs = hours();
  const i = hs.indexOf(h);
  const phase = phaseOf(h);
  const inHour = new Set(proposals(h).map((p) => p.drinkId));
  const neighbors = new Set([...proposals(hs[i - 1]), ...proposals(hs[i + 1])].map((p) => p.drinkId));
  const usage = {};
  for (const hh of hs) for (const p of proposals(hh)) usage[p.drinkId] = (usage[p.drinkId] || 0) + 1;
  const seed = seedFor(h);
  // Der Abend wird stärker: früh eher leichte Drinks, spät eher kräftige
  const strength = { early: -1, mid: 0.3, late: 1 }[phase];

  return allDrinks()
    .filter((d) => !inHour.has(d.id))
    .map((d) => {
      let s = 0;
      if (d.phase.includes(phase)) s += 3;
      else if (d.phase.includes("any")) s += 1.5;
      else s -= 2;
      if (d.featured && d.phase.includes(phase)) s += 2.5;
      if (i === 0 && d.id === "ochsenhell") s += 10; // Wir starten mit Bier
      const sg = d.mix ? 1.2 : grams(d.ml, d.abv) / GRAMS_PER_SG;
      s += strength * Math.min(sg, 2.5) * 0.8;
      if (neighbors.has(d.id)) s -= 2.5;
      s -= (usage[d.id] || 0) * 1.2;
      s += rand(seed, d.id) * 2.5;
      return { d, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.d);
}

// ---------- Schreiben in die Datenbank ----------

function fail(err) {
  console.error(err);
  toast("⚠️ " + (err.code === "PERMISSION_DENIED" ? "Keine Berechtigung" : "Fehler beim Speichern"));
}

async function propose(h, drinkId) {
  const d = drinkById(drinkId);
  if (!d) return;
  let mixer = null;
  if (d.mix) {
    mixer = await chooseMixer(d);
    if (mixer === null) return;
  }
  const name = describe(drinkId, mixer).name;
  const mine = proposals(h).find((p) => p.owner === me);
  if (mine && isAgreed(mine) && !confirm(`Dein Vorschlag für ${fmtHour(h)} ist schon von allen abgesegnet. Wirklich durch ${name} ersetzen?`)) return;
  db.ref(`hours/${h}/${me}`).set({
    drinkId,
    mixer,
    ts: firebase.database.ServerValue.TIMESTAMP,
    votes: { [me]: true },
  }).then(() => toast(`${d.emoji} ${name} für ${fmtHour(h)} vorgeschlagen`), fail);
}

function vote(h, owner, value) {
  const p = proposals(h).find((x) => x.owner === owner);
  const next = p && p.votes[me] === value ? null : value; // nochmal klicken = Stimme zurücknehmen
  db.ref(`hours/${h}/${owner}/votes/${me}`).set(next).catch(fail);
}

function withdraw(h) {
  db.ref(`hours/${h}/${me}`).remove().catch(fail);
}

function saveSettings(patch) {
  db.ref("settings").set({ ...settings(), ...patch }).catch(fail);
}

// ---------- Mischgetränk-Dialog ----------

function chooseMixer(drink) {
  const dlg = $("#mixDialog");
  $("#mixTitle").textContent = `${drink.emoji} ${drink.name} mit…`;
  $("#mixOptions").innerHTML = MIXERS
    .map((m) => `<button class="btn small" value="${esc(m)}">${m === "pur" ? "🥃 pur (Shot)" : esc(m)}</button>`).join("");
  $("#mixCustom").value = "";
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => {
      const v = dlg.returnValue;
      if (v === "custom") resolve($("#mixCustom").value.trim() || null);
      else resolve(v || null);
    }, { once: true });
    dlg.returnValue = "";
    dlg.showModal();
  });
}

// ---------- Rendering ----------

function render() {
  if (!me) return;
  renderControls();
  renderLibrary();
  renderTimeline();
  renderStatus();
  renderSelectBanner();
}

function avatar(u, extra = "") {
  return `<span class="avatar ${extra}" style="--c:${u.color}" title="${esc(u.name)}">${esc(u.name[0])}</span>`;
}

function renderControls() {
  const { start, end } = settings();
  const startSel = $("#startHour");
  const endSel = $("#endHour");
  if (!startSel.options.length) {
    for (let h = 0; h < 24; h++) startSel.add(new Option(fmtHour(h), h));
  }
  startSel.value = start;
  endSel.innerHTML = "";
  for (let i = 1; i <= MAX_HOURS; i++) {
    const h = (start + i) % 24;
    endSel.add(new Option(`${fmtHour(h)} (${i} h)`, h));
  }
  endSel.value = end;
  const u = userById(me);
  $("#meBadge").innerHTML = `${avatar(u)} ${esc(u.name)}`;
}

function renderLibrary() {
  $("#catFilter").innerHTML = [{ id: "all", label: "Alle", emoji: "🍻" }, ...CATEGORIES]
    .map((c) => `<button class="cat ${activeCat === c.id ? "active" : ""}" data-cat="${c.id}">${c.emoji} ${c.label}</button>`)
    .join("");

  const term = searchTerm.trim().toLowerCase();
  const list = allDrinks().filter((d) =>
    (activeCat === "all" || d.cat === activeCat) && (!term || d.name.toLowerCase().includes(term)));

  $("#drinkList").innerHTML = list.length
    ? list.map((d) => `
      <div class="drink-card ${selectedDrinkId === d.id ? "selected" : ""} ${d.featured ? "featured" : ""}" draggable="true" data-drink="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.name)} auswählen">
        <span class="emoji">${esc(d.emoji)}</span>
        <span class="info">
          <span class="name">${esc(d.name)}</span>
          <span class="meta">${drinkMeta(d)}</span>
        </span>
        ${d.id.startsWith("c_") ? `<button class="icon-btn del-custom" data-del-custom="${esc(d.id)}" title="Eigenen Drink löschen">✕</button>` : ""}
      </div>`).join("")
    : `<p class="empty-list">Nix gefunden 🤷 – leg ihn unten selbst an.</p>`;
}

function renderProposal(h, p) {
  const owner = userById(p.owner);
  const info = describe(p.drinkId, p.mixer);
  const agreed = isAgreed(p);
  const pills = USERS.map((u) => {
    const v = p.votes[u.id];
    const cls = v === true ? "yes" : v === false ? "no" : "open";
    const label = v === true ? "dafür" : v === false ? "dagegen" : "hat noch nicht abgestimmt";
    return `<span class="vote-pill ${cls}" style="--c:${u.color}" title="${esc(u.name)} ${label}">${esc(u.name)} ${v === true ? "✓" : v === false ? "✗" : "…"}</span>`;
  }).join("");
  const mine = p.owner === me;
  const actions = mine
    ? `<button class="icon-btn" data-withdraw="${h}" title="Vorschlag zurückziehen">✕</button>`
    : `<button class="vote-btn ${p.votes[me] === true ? "on yes" : ""}" data-vote="yes" data-hour="${h}" data-owner="${p.owner}" title="Dafür">👍</button>
       <button class="vote-btn ${p.votes[me] === false ? "on no" : ""}" data-vote="no" data-hour="${h}" data-owner="${p.owner}" title="Dagegen">👎</button>`;
  return `
    <div class="prop ${agreed ? "agreed" : ""} ${mine ? "mine" : ""} ${!mine && p.votes[me] === undefined ? "needs-me" : ""}">
      <span class="prop-emoji">${esc(info.emoji)}</span>
      <span class="prop-info">
        <span class="prop-name">${esc(info.name)}${agreed ? ` <span class="badge">✅ fest</span>` : ""}</span>
        <span class="prop-by">${mine ? "dein Vorschlag" : `von ${esc(owner.name)}`} · ${fmtNum(info.sg)} SG</span>
      </span>
      <span class="vote-pills">${pills}</span>
      <span class="prop-actions">${actions}</span>
    </div>`;
}

function renderTimeline() {
  const nowH = new Date().getHours();
  $("#timeline").innerHTML = hours().map((h) => {
    const props = proposals(h);
    const agreed = props.filter(isAgreed);
    const phase = phaseOf(h);
    const total = agreed.reduce((s, p) => s + describe(p.drinkId, p.mixer).sg, 0);
    const state = agreed.length ? "done" : props.length ? "voting" : "empty";
    const stateLabel = { done: `✅ steht · ${fmtNum(total)} SG`, voting: "🗳️ Abstimmung läuft", empty: "⚠️ leer" }[state];
    const hasMine = props.some((p) => p.owner === me);
    const sugs = suggest(h, 3).map((d) =>
      `<button class="sug" data-sug="${esc(d.id)}" data-hour="${h}">${esc(d.emoji)} ${esc(d.name)}${d.mix ? " + …" : ""}</button>`).join("");

    return `
      <article class="hour state-${state} ${h === nowH ? "now" : ""} phase-${phase}" data-hour="${h}">
        <div class="hour-head">
          <span class="time">${fmtHour(h)} – ${fmtHour(h + 1)}</span>
          <span class="phase-tag">${PHASE_LABEL[phase]}</span>
          ${h === nowH ? `<span class="now-tag">JETZT</span>` : ""}
          <span class="hour-state">${stateLabel}</span>
        </div>
        <div class="props">
          ${props.map((p) => renderProposal(h, p)).join("") || `<span class="placeholder">Noch kein Vorschlag – Drink hier reinziehen oder unten antippen</span>`}
        </div>
        ${total >= 3 ? `<p class="water">💧 Ordentlich was los – ein Glas Wasser dazwischen?</p>` : ""}
        <div class="suggestions">
          <span class="sug-label">${hasMine ? "Deinen Vorschlag ändern:" : "Dein Vorschlag:"}</span>${sugs}
          <button class="icon-btn shuffle" data-shuffle="${h}" title="Andere Vorschläge">🔄</button>
        </div>
      </article>`;
  }).join("");
}

function renderStatus() {
  const hs = hours();
  const done = hs.filter((h) => proposals(h).some(isAgreed)).length;
  const open = hs.flatMap((h) => proposals(h)).filter((p) => p.owner !== me && p.votes[me] === undefined).length;
  const missingMine = hs.filter((h) => !proposals(h).some((p) => p.owner === me)).length;
  const all = done === hs.length;

  $("#progressBar").style.width = `${(done / hs.length) * 100}%`;
  $(".status").classList.toggle("done", all);
  $("#progressText").innerHTML = all
    ? `✅ <b>Plan steht!</b> Für alle ${hs.length} Stunden habt ihr euch geeinigt.`
    : `<b>${done} / ${hs.length}</b> Stunden geeinigt – noch ${hs.length - done} offen.`;

  const todo = [];
  if (open) todo.push(`🗳️ Du musst noch über <b>${open}</b> Vorschl${open === 1 ? "ag" : "äge"} abstimmen`);
  if (missingMine) todo.push(`✍️ In <b>${missingMine}</b> Stunde${missingMine === 1 ? "" : "n"} fehlt noch dein Vorschlag`);
  $("#todoText").innerHTML = todo.join(" · ") || "👌 Du bist auf dem neuesten Stand.";
}

function renderSelectBanner() {
  const d = selectedDrinkId && drinkById(selectedDrinkId);
  $("#selectBanner").hidden = !d;
  document.body.classList.toggle("selecting", !!d);
  if (d) $("#selectText").textContent = `${d.emoji} ${d.name} ausgewählt – tippe auf eine Stunde.`;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- Login ----------

function showScreen(name) {
  $("#setupScreen").hidden = name !== "setup";
  $("#loginScreen").hidden = name !== "login";
  $("#app").hidden = name !== "app";
}

function renderLoginUsers() {
  $("#loginUsers").innerHTML = USERS.map((u) =>
    `<button type="button" class="login-user ${loginUser === u.id ? "active" : ""}" data-login-user="${u.id}" style="--c:${u.color}">
      ${avatar(u)} ${esc(u.name)}
    </button>`).join("");
}

function setupLogin() {
  renderLoginUsers();
  $("#loginUsers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-login-user]");
    if (!b) return;
    loginUser = b.dataset.loginUser;
    renderLoginUsers();
    $("#loginPassword").focus();
  });
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#loginError").textContent = "";
    auth.signInWithEmailAndPassword(`${loginUser}@${EMAIL_DOMAIN}`, $("#loginPassword").value)
      .then(() => { $("#loginPassword").value = ""; })
      .catch((err) => {
        $("#loginError").textContent = err.code === "auth/too-many-requests"
          ? "Zu viele Versuche – kurz warten."
          : "Login fehlgeschlagen – Passwort falsch?";
      });
  });
  $("#logoutBtn").addEventListener("click", () => auth.signOut());
}

function onAuth(user) {
  if (rootRef) { rootRef.off(); rootRef = null; }
  const id = user && user.email && user.email.split("@")[0];
  if (!user || !userById(id)) {
    me = null;
    if (user) auth.signOut();
    showScreen("login");
    return;
  }
  me = id;
  showScreen("app");
  rootRef = db.ref("/");
  rootRef.on("value", (snap) => {
    const v = snap.val() || {};
    remote = { settings: v.settings || { ...DEFAULT_SETTINGS }, custom: v.custom || {}, hours: v.hours || {} };
    render();
  }, fail);
}

// ---------- Events ----------

function setupApp() {
  const catSelect = document.querySelector("#customForm select[name=cat]");
  CATEGORIES.filter((c) => c.id !== "mix").forEach((c) => catSelect.add(new Option(`${c.emoji} ${c.label}`, c.id)));

  $("#startHour").addEventListener("change", (e) => {
    const { start, end } = settings();
    const s = Number(e.target.value);
    saveSettings({ start: s, end: (s + duration(start, end)) % 24 }); // Länge des Abends beibehalten
  });
  $("#endHour").addEventListener("change", (e) => saveSettings({ end: Number(e.target.value) }));

  $("#search").addEventListener("input", (e) => { searchTerm = e.target.value; renderLibrary(); });
  $("#cancelSelect").addEventListener("click", () => { selectedDrinkId = null; render(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selectedDrinkId) { selectedDrinkId = null; render(); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".drink-card")) {
      e.preventDefault();
      toggleSelect(e.target.dataset.drink);
    }
  });

  $("#customForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const cat = CATEGORIES.find((c) => c.id === f.get("cat"));
    const ref = db.ref("custom").push();
    const drink = {
      id: "c_" + ref.key,
      name: String(f.get("name")).trim(),
      emoji: String(f.get("emoji")).trim() || cat.emoji,
      cat: cat.id,
      ml: Number(f.get("ml")),
      abv: Number(f.get("abv")),
      phase: cat.phase,
      by: me,
    };
    if (!drink.name) return;
    ref.set(drink).then(() => {
      e.target.reset();
      toast(`${drink.emoji} ${drink.name} ist jetzt auf der Karte`);
    }, fail);
  });

  document.addEventListener("click", onClick);
  setupDragAndDrop();
  setInterval(() => me && renderTimeline(), 60 * 1000); // "JETZT"-Markierung aktuell halten
}

function toggleSelect(id) {
  selectedDrinkId = selectedDrinkId === id ? null : id;
  renderLibrary();
  renderSelectBanner();
}

function onClick(e) {
  if (!me) return;
  const t = e.target;
  let el;

  if ((el = t.closest("[data-cat]"))) {
    activeCat = el.dataset.cat;
    renderLibrary();
  } else if ((el = t.closest("[data-del-custom]"))) {
    const id = el.dataset.delCustom;
    const used = hours().some((h) => proposals(h).some((p) => p.drinkId === id));
    if (used) return toast("Der Drink ist noch vorgeschlagen – erst den Vorschlag entfernen");
    if (!confirm(`„${drinkById(id).name}“ von der Karte löschen?`)) return;
    db.ref(`custom/${id.slice(2)}`).remove().catch(fail);
    if (selectedDrinkId === id) selectedDrinkId = null;
  } else if ((el = t.closest("[data-sug]"))) {
    const h = Number(el.dataset.hour);
    sugSeeds[h] = newSeed();
    propose(h, el.dataset.sug);
  } else if ((el = t.closest("[data-shuffle]"))) {
    sugSeeds[el.dataset.shuffle] = newSeed();
    renderTimeline();
  } else if ((el = t.closest("[data-vote]"))) {
    vote(Number(el.dataset.hour), el.dataset.owner, el.dataset.vote === "yes");
  } else if ((el = t.closest("[data-withdraw]"))) {
    withdraw(Number(el.dataset.withdraw));
  } else if ((el = t.closest(".drink-card"))) {
    toggleSelect(el.dataset.drink);
  } else if ((el = t.closest(".hour")) && selectedDrinkId) {
    const id = selectedDrinkId;
    selectedDrinkId = null;
    renderLibrary();
    renderSelectBanner();
    propose(Number(el.dataset.hour), id);
  }
}

function setupDragAndDrop() {
  let dragId = null;

  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest && e.target.closest(".drink-card");
    if (!card) return;
    dragId = card.dataset.drink;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", dragId);
    document.body.classList.add("dragging");
  });

  document.addEventListener("dragend", () => {
    dragId = null;
    document.body.classList.remove("dragging");
    clearOver();
  });

  document.addEventListener("dragover", (e) => {
    if (!dragId) return;
    const hour = e.target.closest && e.target.closest(".hour");
    if (!hour) return clearOver();
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!hour.classList.contains("over")) {
      clearOver();
      hour.classList.add("over");
    }
  });

  document.addEventListener("drop", (e) => {
    if (!dragId) return;
    const hour = e.target.closest && e.target.closest(".hour");
    e.preventDefault();
    const id = dragId;
    dragId = null;
    clearOver();
    if (hour) propose(Number(hour.dataset.hour), id);
  });

  function clearOver() {
    document.querySelectorAll(".over").forEach((el) => el.classList.remove("over"));
  }
}

// ---------- Start ----------

function init() {
  if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey || typeof firebase === "undefined") {
    showScreen("setup");
    return;
  }
  firebase.initializeApp(window.FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.database();
  setupLogin();
  setupApp();
  auth.onAuthStateChanged(onAuth);
}

init();
