"use strict";

const STORAGE_KEY = "geilerabend-v1";
const GRAMS_PER_SG = 10; // 1 Standardglas ≈ 10 g reiner Alkohol
const MAX_HOURS = 12;

const PHASE_LABEL = { early: "Warm-up", mid: "Hauptteil", late: "Endspurt" };

// Vibe verschiebt die Vorschläge in Richtung bestimmter Kategorien.
const VIBES = {
  chill: { bias: { wein: 1, bier: 1, aperitif: 1, cocktail: 0.5, longdrink: -0.5, shot: -4 } },
  party: { bias: { longdrink: 0.5, cocktail: 0.5 } },
  vollgas: { bias: { shot: 1.5, longdrink: 1, cocktail: 0.5, wein: -1 } },
};

// ---------- State ----------

let state = loadFromHash() || loadFromStorage() || defaultState();
let selectedDrinkId = null;
let activeCat = "all";
let searchTerm = "";
const sugSeeds = {}; // pro Stunde ein Zufallsseed, damit Vorschläge stabil bleiben

function defaultState() {
  return { name: "Geiler Abend", start: 19, end: 3, vibe: "party", slots: {}, custom: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* privater Modus o.ä. – egal */ }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

function sanitize(s) {
  const d = defaultState();
  if (!s || typeof s !== "object") return null;
  const out = {
    name: typeof s.name === "string" ? s.name.slice(0, 40) : d.name,
    start: Number.isInteger(s.start) && s.start >= 0 && s.start < 24 ? s.start : d.start,
    end: Number.isInteger(s.end) && s.end >= 0 && s.end < 24 ? s.end : d.end,
    vibe: VIBES[s.vibe] ? s.vibe : d.vibe,
    custom: Array.isArray(s.custom)
      ? s.custom.filter(validCustom).map((c) => ({
        id: c.id, name: c.name.slice(0, 30), emoji: String(c.emoji || "🍸").slice(0, 4), cat: c.cat, ml: c.ml, abv: c.abv,
        phase: CATEGORIES.find((k) => k.id === c.cat).phase,
      }))
      : [],
    slots: {},
  };
  const dur = duration(out.start, out.end);
  if (dur < 1 || dur > MAX_HOURS) out.end = (out.start + 6) % 24;
  const known = new Set(DRINKS.concat(out.custom).map((d) => d.id));
  if (s.slots && typeof s.slots === "object") {
    for (const [h, list] of Object.entries(s.slots)) {
      if (!Array.isArray(list) || !/^\d{1,2}$/.test(h) || Number(h) > 23) continue;
      out.slots[h] = list
        .filter((e) => e && known.has(e.drinkId))
        .map((e) => ({ uid: uid(), drinkId: e.drinkId, locked: !!e.locked }));
    }
  }
  return out;
}

function validCustom(c) {
  return c && typeof c.id === "string" && typeof c.name === "string" &&
    Number.isFinite(c.ml) && Number.isFinite(c.abv) && CATEGORIES.some((k) => k.id === c.cat);
}

// ---------- Helpers ----------

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function duration(start, end) {
  return ((end - start + 24) % 24) || 24;
}

function hours() {
  const len = duration(state.start, state.end);
  return Array.from({ length: len }, (_, i) => (state.start + i) % 24);
}

function fmtHour(h) {
  return String(h % 24).padStart(2, "0") + ":00";
}

function fmtNum(n) {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function allDrinks() {
  return DRINKS.concat(state.custom);
}

function drinkById(id) {
  return allDrinks().find((d) => d.id === id);
}

function sg(d) {
  return (d.ml * d.abv / 100 * 0.8) / GRAMS_PER_SG;
}

function slot(h) {
  return state.slots[h] || [];
}

function phaseOf(h) {
  const hs = hours();
  const t = (hs.indexOf(h) + 0.5) / hs.length;
  return t < 0.34 ? "early" : t < 0.67 ? "mid" : "late";
}

function hourSG(h) {
  return slot(h).reduce((sum, e) => {
    const d = drinkById(e.drinkId);
    return sum + (d ? sg(d) : 0);
  }, 0);
}

// Deterministischer Pseudo-Zufall (seed + key -> 0..1), damit Vorschläge nicht bei jedem Klick springen.
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

// ---------- Vorschlags-Logik ----------

function suggest(h, count = 3, { seed = seedFor(h), cat = null } = {}) {
  const hs = hours();
  const i = hs.indexOf(h);
  const phase = phaseOf(h);
  const inHour = new Set(slot(h).map((e) => e.drinkId));
  const neighborEntries = [...slot(hs[i - 1]), ...slot(hs[i + 1])];
  const neighbors = new Set(neighborEntries.map((e) => e.drinkId));
  const prevCats = new Set(slot(hs[i - 1]).map((e) => drinkById(e.drinkId)?.cat));
  const usage = {};
  for (const hh of hs) for (const e of slot(hh)) usage[e.drinkId] = (usage[e.drinkId] || 0) + 1;
  const bias = VIBES[state.vibe].bias;

  return allDrinks()
    .filter((d) => !inHour.has(d.id) && (!cat || d.cat === cat))
    .map((d) => {
      let s = 0;
      if (d.phase.includes(phase)) s += 3;
      else if (d.phase.includes("any")) s += 2;
      s += bias[d.cat] || 0;
      if (neighbors.has(d.id)) s -= 2.5;
      s -= (usage[d.id] || 0) * 1.2;
      if (prevCats.has(d.cat)) s -= 0.8;
      s += rand(seed, d.id) * 2.5;
      return { d, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.d);
}

function addDrink(h, drinkId, locked = true) {
  if (!drinkById(drinkId)) return;
  (state.slots[h] ||= []).push({ uid: uid(), drinkId, locked });
}

function fillGaps() {
  let added = 0;
  for (const h of hours()) {
    if (slot(h).length > 0) continue;
    const [best] = suggest(h, 1, { seed: newSeed() });
    if (!best) continue;
    addDrink(h, best.id, false);
    added++;

    const phase = phaseOf(h);
    const wantsShot =
      (state.vibe === "vollgas" && phase !== "early") ||
      (state.vibe === "party" && phase === "late" && Math.random() < 0.4);
    if (wantsShot && best.cat !== "shot") {
      const [shot] = suggest(h, 1, { seed: newSeed(), cat: "shot" });
      if (shot) { addDrink(h, shot.id, false); added++; }
    }
  }
  return added;
}

function reroll() {
  let kept = 0;
  for (const h of hours()) {
    state.slots[h] = slot(h).filter((e) => e.locked);
    kept += state.slots[h].length;
    sugSeeds[h] = newSeed();
  }
  fillGaps();
  return kept;
}

function removeEntry(h, entryUid) {
  state.slots[h] = slot(h).filter((e) => e.uid !== entryUid);
}

function moveEntry(from, entryUid, to) {
  if (String(from) === String(to)) return;
  const entry = slot(from).find((e) => e.uid === entryUid);
  if (!entry) return;
  removeEntry(from, entryUid);
  (state.slots[to] ||= []).push(entry);
}

// ---------- Teilen ----------

function encodePlan() {
  const slots = {};
  for (const h of hours()) {
    if (slot(h).length) slots[h] = slot(h).map((e) => ({ drinkId: e.drinkId, locked: e.locked }));
  }
  const used = new Set(Object.values(slots).flat().map((e) => e.drinkId));
  const payload = { ...state, slots, custom: state.custom.filter((c) => used.has(c.id)) };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadFromHash() {
  const m = location.hash.match(/^#p=([\w-]+)$/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const s = sanitize(JSON.parse(new TextDecoder().decode(bytes)));
    if (s) {
      // Geteilte eigene Drinks mit evtl. schon vorhandenen lokalen zusammenführen
      const local = loadFromStorage();
      if (local) for (const c of local.custom) if (!s.custom.some((x) => x.id === c.id)) s.custom.push(c);
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(() => toast("📥 Geteilter Plan geladen"), 300);
    }
    return s;
  } catch (_) {
    return null;
  }
}

async function share() {
  const url = location.origin + location.pathname + "#p=" + encodePlan();
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: state.name, text: `Unser Plan für „${state.name}“ 🍻`, url });
      return;
    } catch (_) { /* abgebrochen -> Fallback */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("🔗 Link kopiert – ab in die Gruppe damit!");
  } catch (_) {
    prompt("Link kopieren:", url);
  }
}

// ---------- Rendering ----------

const $ = (sel) => document.querySelector(sel);

function render() {
  renderControls();
  renderLibrary();
  renderTimeline();
  renderStatus();
  renderSelectBanner();
  save();
}

function renderControls() {
  const startSel = $("#startHour");
  const endSel = $("#endHour");
  if (!startSel.options.length) {
    for (let h = 0; h < 24; h++) startSel.add(new Option(fmtHour(h), h));
  }
  startSel.value = state.start;
  endSel.innerHTML = "";
  for (let i = 1; i <= MAX_HOURS; i++) {
    const h = (state.start + i) % 24;
    endSel.add(new Option(`${fmtHour(h)} (${i} h)`, h));
  }
  endSel.value = state.end;
  $("#vibe").value = state.vibe;
  if (document.activeElement !== $("#eventName")) $("#eventName").value = state.name;
  document.title = `${state.name} 🍻`;
}

function renderLibrary() {
  const catEl = $("#catFilter");
  catEl.innerHTML = [{ id: "all", label: "Alle", emoji: "🍻" }, ...CATEGORIES]
    .map((c) => `<button class="cat ${activeCat === c.id ? "active" : ""}" data-cat="${c.id}">${c.emoji} ${c.label}</button>`)
    .join("");

  const term = searchTerm.trim().toLowerCase();
  const list = allDrinks().filter((d) =>
    (activeCat === "all" || d.cat === activeCat) && (!term || d.name.toLowerCase().includes(term)));

  $("#drinkList").innerHTML = list.length
    ? list.map((d) => `
      <div class="drink-card ${selectedDrinkId === d.id ? "selected" : ""}" draggable="true" data-drink="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.name)} auswählen">
        <span class="emoji">${esc(d.emoji)}</span>
        <span class="info">
          <span class="name">${esc(d.name)}</span>
          <span class="meta">${d.ml} ml · ${fmtNum(d.abv)} % · ${fmtNum(sg(d))} SG</span>
        </span>
        ${d.id.startsWith("c_") ? `<button class="icon-btn del-custom" data-del-custom="${esc(d.id)}" title="Eigenen Drink löschen">✕</button>` : ""}
      </div>`).join("")
    : `<p class="empty-list">Nix gefunden 🤷 – leg ihn unten selbst an.</p>`;
}

function renderTimeline() {
  const nowH = new Date().getHours();
  $("#timeline").innerHTML = hours().map((h) => {
    const entries = slot(h);
    const phase = phaseOf(h);
    const total = hourSG(h);
    const chips = entries.map((e) => {
      const d = drinkById(e.drinkId);
      if (!d) return "";
      return `
        <span class="chip ${e.locked ? "locked" : ""}" draggable="true" data-uid="${e.uid}" data-from="${h}">
          <span class="chip-emoji">${esc(d.emoji)}</span>${esc(d.name)}
          <button class="icon-btn" data-lock="${e.uid}" data-hour="${h}" title="${e.locked ? "Fest eingeplant – lösen" : "Fest einplanen"}">${e.locked ? "📌" : "📍"}</button>
          <button class="icon-btn" data-remove="${e.uid}" data-hour="${h}" title="Entfernen">✕</button>
        </span>`;
    }).join("");
    const sugs = suggest(h, 3).map((d) =>
      `<button class="sug" data-sug="${esc(d.id)}" data-hour="${h}">${esc(d.emoji)} ${esc(d.name)}</button>`).join("");

    return `
      <article class="hour ${entries.length ? "" : "empty"} ${h === nowH ? "now" : ""} phase-${phase}" data-hour="${h}">
        <div class="hour-head">
          <span class="time">${fmtHour(h)} – ${fmtHour(h + 1)}</span>
          <span class="phase-tag">${PHASE_LABEL[phase]}</span>
          ${h === nowH ? `<span class="now-tag">JETZT</span>` : ""}
          <span class="hour-sg">${entries.length ? fmtNum(total) + " SG" : "⚠️ leer"}</span>
        </div>
        <div class="drinks">
          ${chips || `<span class="placeholder">Noch nix im Glas – Drink hier reinziehen oder Vorschlag antippen</span>`}
        </div>
        ${total >= 3 ? `<p class="water">💧 Ordentlich was los – ein Glas Wasser dazwischen?</p>` : ""}
        <div class="suggestions">
          <span class="sug-label">Vorschläge:</span>${sugs}
          <button class="icon-btn shuffle" data-shuffle="${h}" title="Andere Vorschläge">🔄</button>
        </div>
      </article>`;
  }).join("");
}

function renderStatus() {
  const hs = hours();
  const filled = hs.filter((h) => slot(h).length > 0).length;
  const drinks = hs.reduce((n, h) => n + slot(h).length, 0);
  const total = hs.reduce((n, h) => n + hourSG(h), 0);
  const locked = hs.reduce((n, h) => n + slot(h).filter((e) => e.locked).length, 0);
  const done = filled === hs.length;

  $("#progressBar").style.width = `${(filled / hs.length) * 100}%`;
  $(".status").classList.toggle("done", done);
  $("#progressText").innerHTML = (done
    ? `✅ <b>Plan steht!</b> Alle ${hs.length} Stunden sind versorgt.`
    : `<b>${filled} / ${hs.length}</b> Stunden versorgt – noch ${hs.length - filled} leer.`)
    + ` <span class="muted">· ${drinks} Drinks (${locked} fest) · ≈ ${fmtNum(total)} SG</span>`;
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

// ---------- Events ----------

function setup() {
  const catSelect = document.querySelector("#customForm select[name=cat]");
  CATEGORIES.forEach((c) => catSelect.add(new Option(`${c.emoji} ${c.label}`, c.id)));

  $("#eventName").addEventListener("input", (e) => {
    state.name = e.target.value || "Geiler Abend";
    document.title = `${state.name} 🍻`;
    save();
  });

  $("#startHour").addEventListener("change", (e) => {
    const len = duration(state.start, state.end);
    state.start = Number(e.target.value);
    state.end = (state.start + len) % 24; // Länge des Abends beibehalten
    render();
  });
  $("#endHour").addEventListener("change", (e) => { state.end = Number(e.target.value); render(); });
  $("#vibe").addEventListener("change", (e) => { state.vibe = e.target.value; render(); });

  $("#search").addEventListener("input", (e) => { searchTerm = e.target.value; renderLibrary(); });

  $("#fillBtn").addEventListener("click", () => {
    const n = fillGaps();
    render();
    toast(n ? `✨ ${n} Drinks eingeplant` : "Alles schon belegt 👌");
  });
  $("#rerollBtn").addEventListener("click", () => {
    const kept = reroll();
    render();
    toast(`🎲 Neu gewürfelt – ${kept} feste Drinks behalten`);
  });
  $("#shareBtn").addEventListener("click", share);
  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Wirklich alle Drinks aus dem Plan entfernen?")) return;
    state.slots = {};
    render();
  });
  $("#cancelSelect").addEventListener("click", () => { selectedDrinkId = null; render(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selectedDrinkId) { selectedDrinkId = null; render(); }
  });

  $("#customForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const cat = f.get("cat");
    const drink = {
      id: "c_" + uid(),
      name: String(f.get("name")).trim(),
      emoji: String(f.get("emoji")).trim() || CATEGORIES.find((c) => c.id === cat).emoji,
      cat,
      ml: Number(f.get("ml")),
      abv: Number(f.get("abv")),
      phase: CATEGORIES.find((c) => c.id === cat).phase,
    };
    if (!drink.name) return;
    state.custom.push(drink);
    e.target.reset();
    activeCat = "all";
    render();
    toast(`${drink.emoji} ${drink.name} ist jetzt auf der Karte`);
  });

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".drink-card")) {
      e.preventDefault();
      toggleSelect(e.target.dataset.drink);
    }
  });

  setupDragAndDrop();

  // "JETZT"-Markierung aktuell halten
  setInterval(renderTimeline, 60 * 1000);
}

function toggleSelect(id) {
  selectedDrinkId = selectedDrinkId === id ? null : id;
  renderLibrary();
  renderSelectBanner();
}

function onClick(e) {
  const t = e.target;
  let el;

  if ((el = t.closest("[data-cat]"))) {
    activeCat = el.dataset.cat;
    renderLibrary();
  } else if ((el = t.closest("[data-del-custom]"))) {
    const id = el.dataset.delCustom;
    const d = drinkById(id);
    if (!confirm(`„${d.name}“ von der Karte löschen? Er fliegt auch aus dem Plan.`)) return;
    state.custom = state.custom.filter((c) => c.id !== id);
    for (const h of Object.keys(state.slots)) state.slots[h] = state.slots[h].filter((e) => e.drinkId !== id);
    if (selectedDrinkId === id) selectedDrinkId = null;
    render();
  } else if ((el = t.closest("[data-sug]"))) {
    const h = Number(el.dataset.hour);
    addDrink(h, el.dataset.sug, true);
    sugSeeds[h] = newSeed();
    render();
  } else if ((el = t.closest("[data-shuffle]"))) {
    sugSeeds[el.dataset.shuffle] = newSeed();
    renderTimeline();
  } else if ((el = t.closest("[data-lock]"))) {
    const entry = slot(el.dataset.hour).find((x) => x.uid === el.dataset.lock);
    if (entry) entry.locked = !entry.locked;
    render();
  } else if ((el = t.closest("[data-remove]"))) {
    removeEntry(el.dataset.hour, el.dataset.remove);
    render();
  } else if ((el = t.closest(".drink-card"))) {
    toggleSelect(el.dataset.drink);
  } else if ((el = t.closest(".hour")) && selectedDrinkId) {
    const d = drinkById(selectedDrinkId);
    addDrink(Number(el.dataset.hour), selectedDrinkId, true);
    selectedDrinkId = null;
    render();
    toast(`${d.emoji} ${d.name} → ${fmtHour(Number(el.dataset.hour))}`);
  }
}

function setupDragAndDrop() {
  let dragData = null;

  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".drink-card");
    const chip = e.target.closest?.(".chip");
    if (card) dragData = { type: "new", drinkId: card.dataset.drink };
    else if (chip) dragData = { type: "move", from: chip.dataset.from, uid: chip.dataset.uid };
    else return;
    e.dataTransfer.effectAllowed = card ? "copy" : "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    document.body.classList.add("dragging", dragData.type === "move" ? "dragging-chip" : "dragging-new");
  });

  document.addEventListener("dragend", () => {
    dragData = null;
    document.body.classList.remove("dragging", "dragging-chip", "dragging-new");
    clearOver();
  });

  document.addEventListener("dragover", (e) => {
    if (!dragData) return;
    const hour = e.target.closest?.(".hour");
    const lib = e.target.closest?.("#library");
    if (hour || (lib && dragData.type === "move")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = hour ? (dragData.type === "new" ? "copy" : "move") : "move";
      const target = hour || lib;
      if (!target.classList.contains("over")) {
        clearOver();
        target.classList.add("over");
      }
    } else {
      clearOver();
    }
  });

  document.addEventListener("drop", (e) => {
    if (!dragData) return;
    const hour = e.target.closest?.(".hour");
    const lib = e.target.closest?.("#library");
    e.preventDefault();
    if (hour) {
      const h = Number(hour.dataset.hour);
      if (dragData.type === "new") addDrink(h, dragData.drinkId, true);
      else moveEntry(Number(dragData.from), dragData.uid, h);
    } else if (lib && dragData.type === "move") {
      removeEntry(Number(dragData.from), dragData.uid);
      toast("🗑️ Drink entfernt");
    }
    dragData = null;
    clearOver();
    render();
  });

  function clearOver() {
    document.querySelectorAll(".over").forEach((el) => el.classList.remove("over"));
  }
}

setup();
render();
