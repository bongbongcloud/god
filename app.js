/* Abide — daily walk. Plain JS, no build step. */
(() => {
  "use strict";
  const APP_VERSION = "3.2";

  // ------------------------------------------------------------ utilities
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayKey();
  const nowIso = () => new Date().toISOString();
  const fmtDate = (s, opts = { weekday: "short", day: "numeric", month: "short" }) => {
    if (!s) return "";
    const d = s.length === 10 ? new Date(s + "T00:00:00") : new Date(s);
    return isNaN(d) ? "" : d.toLocaleDateString("en-SG", opts);
  };
  const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso)) / 864e5);
  const relDate = (iso) => {
    if (!iso) return "";
    const n = daysAgo(iso);
    return n <= 0 ? "today" : n === 1 ? "yesterday" : n < 7 ? `${n} days ago` : fmtDate(iso);
  };
  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2200);
  };
  const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? "Still up?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Good night";
  };
  const seededPick = (arr, seed) => arr[Math.abs([...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % arr.length];

  const C = window.CONTENT;

  // ------------------------------------------------------------ store
  // Everything lives in `S.data`, mirrored to localStorage and (if signed in) Firestore.
  const LS_KEY = "abide.v1";
  const S = {
    data: { prayers: {}, recaps: {}, days: {}, verses: {}, settings: { hiddenSources: [] } },
    feed: null,
    mode: "local",     // local | cloud
    user: null,
    fs: null,
    unsub: [],
    listeners: new Set(),
  };

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        S.data = { prayers: {}, recaps: {}, days: {}, verses: {}, settings: { hiddenSources: [] }, ...d };
      }
    } catch (e) { console.warn("local load failed", e); }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S.data)); } catch (e) { console.warn("local save failed", e); }
  }
  function emit() { saveLocal(); S.listeners.forEach((fn) => fn()); }

  // put/remove are the only write paths. coll ∈ prayers | recaps | days
  function put(coll, item) {
    item.updated = nowIso();
    S.data[coll][item.id] = item;
    if (S.mode === "cloud" && S.fs) {
      S.fs.collection("users").doc(S.user.uid).collection(coll).doc(item.id).set(item, { merge: true })
        .catch((e) => { console.error(e); toast("Cloud save failed — kept locally"); });
    }
    emit();
    return item;
  }
  function remove(coll, id) {
    delete S.data[coll][id];
    if (S.mode === "cloud" && S.fs) {
      S.fs.collection("users").doc(S.user.uid).collection(coll).doc(id).delete().catch(console.error);
    }
    emit();
  }
  function saveSettings() {
    if (S.mode === "cloud" && S.fs) {
      S.fs.collection("users").doc(S.user.uid).set({ settings: S.data.settings }, { merge: true }).catch(console.error);
    }
    emit();
  }
  const list = (coll) => Object.values(S.data[coll]);
  const day = (k = today()) => S.data.days[k] || { id: k, date: k, acts: {}, prayed: [] };
  const saveDay = (d) => put("days", d);
  const settings = () => S.data.settings;
  const groups = () => settings().groups || C.defaultGroups;
  const translation = () => settings().translation || "ESV";

  // ------------------------------------------------------------ reading plans
  function planReadings(plan) {
    const chapters = [];
    (plan.books || []).forEach((b) => {
      const n = (C.books.find((x) => x[0] === b) || [])[1] || 0;
      for (let i = 1; i <= n; i++) chapters.push({ book: b, ch: i });
    });
    const per = Math.max(1, plan.perDay || 1), out = [];
    for (let i = 0; i < chapters.length; i += per) out.push(chapters.slice(i, i + per));
    return out;
  }
  function refOf(chunk) {
    const parts = [];
    chunk.forEach((c) => {
      const last = parts[parts.length - 1];
      if (last && last.book === c.book && last.to === c.ch - 1) last.to = c.ch;
      else parts.push({ book: c.book, from: c.ch, to: c.ch });
    });
    return parts.map((p) => `${p.book === "Psalms" ? "Psalm" : p.book} ${p.from}${p.to > p.from ? "–" + p.to : ""}`).join("; ");
  }
  const bibleUrl = (ref) => `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref.replace(/–/g, "-"))}&version=${translation()}`;
  function currentReading() {
    const plan = settings().plan; if (!plan) return null;
    const readings = planReadings(plan);
    const i = Math.min(plan.progress || 0, readings.length);
    return { plan, readings, index: i, total: readings.length, finished: i >= readings.length, ref: i < readings.length ? refOf(readings[i]) : null, chunk: i < readings.length ? readings[i] : [] };
  }

  // ------------------------------------------------------------ firebase
  function initFirebase() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !window.firebase) { setPill("local", "pill-muted", "This device only"); return; }
    try {
      firebase.initializeApp(cfg);
      S.fs = firebase.firestore();
      S.fs.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      firebase.auth().onAuthStateChanged((user) => {
        S.user = user;
        if (user) attachCloud(); else detachCloud();
        render();
      });
      setPill("signed out", "pill-warn", "Sign in to sync");
    } catch (e) {
      console.error("Firebase init failed", e);
      setPill("local", "pill-muted", "Firebase config error — see console");
    }
  }
  function setPill(text, cls, title) {
    const p = $("#sync-pill"); p.textContent = text; p.className = `pill ${cls}`; p.title = title || "";
  }
  function attachCloud() {
    S.mode = "cloud";
    setPill("syncing", "pill-warn");
    const root = S.fs.collection("users").doc(S.user.uid);
    const localCopy = JSON.parse(JSON.stringify(S.data));
    let first = { prayers: true, recaps: true, days: true, verses: true };
    ["prayers", "recaps", "days", "verses"].forEach((coll) => {
      const un = root.collection(coll).onSnapshot((snap) => {
        const next = {};
        snap.forEach((doc) => (next[doc.id] = doc.data()));
        // First snapshot: upload anything that only exists locally (one-time merge).
        if (first[coll]) {
          first[coll] = false;
          Object.values(localCopy[coll]).forEach((it) => {
            if (!next[it.id]) { next[it.id] = it; root.collection(coll).doc(it.id).set(it).catch(console.error); }
          });
        }
        S.data[coll] = next;
        if (!Object.values(first).some(Boolean)) setPill("synced", "pill-ok", `Signed in as ${S.user.email || S.user.displayName || "you"}`);
        emit();
      }, (err) => { console.error(err); setPill("error", "pill-warn", err.message); toast("Sync error: " + err.message); });
      S.unsub.push(un);
    });
    const un = root.onSnapshot((doc) => {
      const s = doc.data()?.settings; if (s) { S.data.settings = { hiddenSources: [], ...s }; emit(); }
    });
    S.unsub.push(un);
  }
  function detachCloud() {
    S.unsub.forEach((fn) => fn()); S.unsub = [];
    S.mode = "local";
    if (S.fs) setPill("signed out", "pill-warn", "Sign in to sync");
  }
  async function signIn() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      toast("Signed in");
    } catch (e) { console.error(e); toast("Sign-in failed: " + (e.code || e.message)); }
  }
  async function signOut() { await firebase.auth().signOut(); toast("Signed out — data stays on this device"); }

  // ------------------------------------------------------------ feed
  async function loadFeed() {
    try {
      const r = await fetch("data/feed.json?t=" + Math.floor(Date.now() / 6e5), { cache: "no-cache" });
      S.feed = await r.json();
    } catch (e) {
      console.warn("feed load failed", e);
      S.feed = { generated: null, sources: [] };
    }
    render();
  }

  // ------------------------------------------------------------ router
  const routes = {};
  const afterRender = {};
  function render() {
    const hash = location.hash.replace(/^#\/?/, "") || "home";
    const [name, arg, arg2] = hash.split("/").map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    const fn = routes[name] || routes.home;
    const view = $("#view");
    view.innerHTML = fn(arg, arg2) || "";
    if (afterRender[name]) afterRender[name](arg, arg2);
    $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name || (name === "prayers" && a.dataset.tab === "pray")));
  }
  window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0 }); });
  // Re-render on data changes, unless the user is mid-typing (typing fields keep their state).
  S.listeners.add(() => {
    const a = document.activeElement;
    if (a && a.matches("textarea, input[type=text], input[type=date], select")) return;
    render();
  });

  // Event delegation: any element with data-act="name" dispatches to ACT[name](el, event)
  const ACT = {};
  function bind(view) {
    view.addEventListener("click", (e) => {
      const el = e.target.closest("[data-act]");
      if (!el || !ACT[el.dataset.act]) return;
      if (el.tagName === "A" && el.getAttribute("href")?.startsWith("http")) { ACT[el.dataset.act](el, e); return; } // let link open
      e.preventDefault();
      ACT[el.dataset.act](el, e);
    });
    view.addEventListener("change", (e) => {
      const el = e.target.closest("[data-change]");
      if (el && ACT[el.dataset.change]) ACT[el.dataset.change](el, e);
    });
  }

  // ------------------------------------------------------------ HOME
  routes.home = () => {
    const d = day();
    const v = seededPick(C.verses, today());
    const open = list("prayers").filter((p) => p.status !== "answered");
    const stale = open.filter((p) => !p.lastPrayed || daysAgo(p.lastPrayed) >= 3);
    const actsDone = ["A", "C", "T", "S"].filter((k) => d.acts?.[k]).length;
    const streak = computeStreak();
    const dateStr = new Date().toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long" });

    return `
    <div class="stack">
      <div>
        <div class="eyebrow">${esc(dateStr)}</div>
        <h1>${greeting()}, Bryan.</h1>
        <p class="muted">What would you like to do with God today?</p>
      </div>

      <div class="card accent">
        <div class="verse">“${esc(v.text)}”</div>
        <div class="verse-ref">— ${esc(v.ref)} (WEB)</div>
      </div>

      <div class="choices">
        ${(() => {
          const r = currentReading();
          const doneToday = (d.readingsDone || []).length;
          if (!r) return `<a class="choice" href="#bible"><div class="choice-ico bible">✝</div><div class="choice-body"><div class="choice-title">Start a Bible reading plan</div><div class="choice-sub">The Gospels, a Psalm a day, or any book you choose</div></div></a>`;
          return `<a class="choice ${doneToday ? "done" : ""}" href="#bible">
            <div class="choice-ico bible">✝</div>
            <div class="choice-body">
              <div class="choice-title">${doneToday ? "Read: " + esc(d.readingsDone.join(", ")) : r.finished ? "Plan finished 🎉" : "Read " + esc(r.ref)}</div>
              <div class="choice-sub">${esc(r.plan.name)} · ${r.index} of ${r.total}${!doneToday && r.ref ? " · open in " + esc(translation()) : ""}</div>
            </div>
            ${doneToday ? '<div class="choice-done">✓</div>' : ""}
          </a>`;
        })()}
        <a class="choice ${d.devotional ? "done" : ""}" href="#devotional">
          <div class="choice-ico read">🎧</div>
          <div class="choice-body">
            <div class="choice-title">Devotional or podcast</div>
            <div class="choice-sub">${d.devotional ? "Today: " + esc(d.devotional.title) : "Piper, Keller, Stanley, Begg — pick one by title"}</div>
          </div>
          ${d.devotional ? '<div class="choice-done">✓</div>' : ""}
        </a>
        <a class="choice ${actsDone === 4 ? "done" : ""}" href="#pray">
          <div class="choice-ico pray">🙏</div>
          <div class="choice-body">
            <div class="choice-title">Pray through ACTS</div>
            <div class="choice-sub">${actsDone === 4 ? "Prayed all four today · " : actsDone ? `${actsDone} of 4 done · ` : ""}${open.length} open prayer point${open.length === 1 ? "" : "s"}${stale.length ? ` · ${stale.length} not prayed in a while` : ""}</div>
          </div>
          ${actsDone === 4 ? '<div class="choice-done">✓</div>' : ""}
        </a>
        <a class="choice ${d.recap ? "done" : ""}" href="#recap/new">
          <div class="choice-ico recap">✎</div>
          <div class="choice-body">
            <div class="choice-title">Recap a sermon or study</div>
            <div class="choice-sub">${d.recap ? "Recapped today" : "Capture what you learnt before it fades"}</div>
          </div>
          ${d.recap ? '<div class="choice-done">✓</div>' : ""}
        </a>
      </div>

      <div class="stats">
        <a class="card flat stat" href="#journal"><b>${streak}</b><span>day streak</span></a>
        <a class="card flat stat" href="#prayers"><b>${open.length}</b><span>open prayers</span></a>
        <a class="card flat stat" href="#answered"><b>${list("prayers").filter((p) => p.status === "answered").length}</b><span>answered</span></a>
      </div>
      ${(() => { const f = focusGroups(); return f.length ? `<div class="card flat"><div class="eyebrow">Today’s prayer focus</div><div class="serif" style="font-size:1.1rem">${f.map((g) => esc(g.name)).join(" · ")}</div><div class="tiny">${countOpenFor(f)} open point${countOpenFor(f) === 1 ? "" : "s"} · <a href="#pray/S">pray for them →</a> · <a href="#quiet/S">5-min quiet prayer →</a></div></div>` : ""; })()}
      ${stale.length ? `
      <div class="card flat">
        <div class="eyebrow">Keep bringing these</div>
        ${stale.slice(0, 3).map((p) => `<div class="point"><div class="point-body"><div class="point-text">${esc(p.text)}</div><div class="point-meta">last prayed ${p.lastPrayed ? relDate(p.lastPrayed) : "never"}</div></div></div>`).join("")}
        <a href="#pray/S" class="btn btn-ghost btn-sm">Pray for them now →</a>
      </div>` : ""}
    </div>`;
  };

  function computeStreak() {
    let n = 0;
    const dt = new Date();
    for (let i = 0; i < 400; i++) {
      const k = dayKey(dt);
      const d = S.data.days[k];
      const active = d && (d.devotional || d.recap || (d.readingsDone || []).length || d.quietMin || Object.values(d.acts || {}).some(Boolean) || (d.prayed || []).length);
      if (active) n++;
      else if (i > 0) break; // today can still be empty without breaking the streak
      dt.setDate(dt.getDate() - 1);
    }
    return n;
  }

  // ------------------------------------------------------------ BIBLE (reading plan)
  let planPicker = false;
  routes.bible = () => {
    const d = day();
    const r = currentReading();
    const doneToday = d.readingsDone || [];
    if (!r || planPicker) return renderPlanPicker(r);
    const pct = Math.round((r.index / r.total) * 100);
    return `
    <div class="stack">
      <div class="row between">
        <div><h1>Bible</h1><div class="tiny">${esc(r.plan.name)} · ${r.index} of ${r.total} readings · ${pct}%</div></div>
        <button class="btn-sm" data-act="planPicker">change plan</button>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>

      ${r.finished ? `<div class="card accent"><h2>You finished ${esc(r.plan.name)} 🎉</h2><p class="muted">Start another plan, or read it again with fresh eyes.</p><button data-act="planPicker">Choose next plan</button></div>` : `
      <div class="card">
        <div class="row between">
          <div><div class="eyebrow">${doneToday.length ? "Next reading" : "Today’s reading"}</div><h2>${esc(r.ref)}</h2></div>
          ${readerTools()}
        </div>
        <p class="muted small" style="margin-top:6px">Read slowly. Ask what it shows about God, about us, and where Jesus is — then let it become prayer. Tap a verse to keep it.</p>
        <div id="reader" class="reader" style="font-size:${readerFs()}rem"><div class="empty">Loading…</div></div>
        <div class="row" style="margin-top:12px">
          <button class="btn-primary" data-act="markRead">I’ve read it ✓</button>
          <a class="btn btn-sm" href="${bibleUrl(r.ref)}" target="_blank" rel="noopener">Open in ${esc(translation())} ↗</a>
        </div>
      </div>`}

      ${doneToday.length ? `
      <div class="card">
        <div class="eyebrow">Read today · ${esc(doneToday.join(", "))}</div>
        <div class="eyebrow" style="margin-top:10px">Gospel lens</div>
        ${lensFields(d.readingLens)}
        <div class="row">
          <button class="btn-primary" data-act="saveLens" data-target="readingLens">Save reflection</button>
          <button data-act="lensToPrayer" data-target="readingLens" data-from="${esc(doneToday.join(", "))}">Turn response into a prayer point</button>
        </div>
      </div>` : ""}
      ${browseBox()}
      <p class="tiny">Sequential plan: a missed day just means you continue where you left off. No backlog.</p>
    </div>`;
  };
  afterRender.bible = () => { const r = currentReading(); if (r && !planPicker && !r.finished) mountReader(r.chunk); };

  // ------------------------------------------------------------ READER (inline Bible text)
  const readerCache = {};
  let selVerse = null;
  const bookSlug = (b) => b.toLowerCase().replace(/ /g, "");
  const readerFs = () => { try { return +(localStorage.getItem("abide.fs") || 1.05); } catch (e) { return 1.05; } };
  const bookChapters = (b) => (C.books.find((x) => x[0] === b) || [])[1] || 0;
  const displayBook = (b) => (b === "Psalms" ? "Psalm" : b);

  function readerTools() {
    const n = list("verses").length;
    return `<div class="reader-tools">
      <button class="btn-sm" data-act="fontSize" data-v="-1" title="Smaller text">A−</button>
      <button class="btn-sm" data-act="fontSize" data-v="1" title="Larger text">A+</button>
      <a class="btn btn-sm" href="#verses" title="Saved verses">♥ ${n}</a>
    </div>`;
  }

  async function fetchESV(q, key) {
    const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(q)}&include-headings=false&include-footnotes=false&include-footnote-body=false&include-short-copyright=false&include-passage-references=false&include-verse-numbers=true&include-first-verse-numbers=true&indent-poetry=false&indent-paragraphs=0&indent-declares=0&indent-psalm-doxology=0&line-length=0`;
    const res = await fetch(url, { headers: { Authorization: "Token " + key } });
    if (!res.ok) throw new Error("ESV API " + res.status);
    const j = await res.json();
    const text = (j.passages || [])[0] || "";
    const parts = text.split(/\[(\d+)\]/);
    const verses = [];
    for (let i = 1; i < parts.length; i += 2) verses.push({ v: +parts[i], t: parts[i + 1].replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim() });
    if (!verses.length) throw new Error("ESV: empty passage");
    return verses;
  }

  async function getChapter(book, ch) {
    const key = settings().esvKey;
    const id = `${book} ${ch}`;
    if (key && navigator.onLine !== false) {
      if (readerCache["ESV:" + id]) return readerCache["ESV:" + id];
      try {
        const verses = await fetchESV(`${displayBook(book)} ${ch}`, key);
        return (readerCache["ESV:" + id] = { book, chapter: ch, translation: "ESV", verses });
      } catch (e) { console.warn("ESV failed, falling back to WEB:", e.message); }
    }
    if (readerCache["WEB:" + id]) return readerCache["WEB:" + id];
    const r = await fetch(`data/bible/web/${bookSlug(book)}/${ch}.json`);
    if (!r.ok) throw new Error("missing");
    const data = await r.json();
    return (readerCache["WEB:" + id] = { book, chapter: ch, translation: "WEB", verses: data.verses });
  }

  function chapterHtml(c) {
    return `
    <div class="chapter">
      <div class="chapter-head">${esc(displayBook(c.book))} ${c.chapter} <span class="tiny">${esc(c.translation)}</span></div>
      <p class="verses">${c.verses.map((v) => {
        const ref = `${displayBook(c.book)} ${c.chapter}:${v.v}`;
        const sel = selVerse && selVerse.ref === ref;
        return `<span class="verse ${sel ? "sel" : ""}" data-act="tapVerse" data-ref="${esc(ref)}" data-tr="${esc(c.translation)}"><sup>${v.v}</sup>${esc(v.t).replace(/\n/g, "<br>")}</span>${sel ? verseBar(ref) : ""} `;
      }).join("")}</p>
    </div>`;
  }
  function verseBar(ref) {
    const saved = list("verses").some((x) => x.ref === ref);
    return `<span class="verse-bar"><button class="btn-sm ${saved ? "" : "btn-primary"}" data-act="saveVerse" ${saved ? "disabled" : ""}>${saved ? "♥ saved" : "♥ Save verse"}</button><button class="btn-sm" data-act="verseToPrayer">🙏 Pray this</button><button class="btn-sm" data-act="copyVerse">copy</button><button class="btn-sm btn-ghost" data-act="tapVerse" data-ref="${esc(ref)}">✕</button></span>`;
  }

  async function mountReader(chunk) {
    const el = $("#reader"); if (!el || !chunk?.length) return;
    try {
      const chapters = await Promise.all(chunk.map((c) => getChapter(c.book, c.ch)));
      if (!$("#reader")) return;
      el.innerHTML = chapters.map(chapterHtml).join("") + readerFooter(chapters[0].translation);
    } catch (e) {
      el.innerHTML = `<div class="empty">Bible text isn’t in the repo yet. In GitHub → <b>Actions</b> → “Fetch Bible text (WEB)” → <b>Run workflow</b> (one time, ~1 min), then reload.<br><br><a class="btn btn-sm" href="${bibleUrl(refOf(chunk))}" target="_blank" rel="noopener">Open on BibleGateway instead ↗</a></div>`;
    }
  }
  function readerFooter(tr) {
    return tr === "ESV"
      ? `<div class="tiny reader-credit">Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway. Used by permission.</div>`
      : `<div class="tiny reader-credit">World English Bible (WEB), public domain.${settings().esvKey ? " ESV unavailable right now — showing WEB." : ""}</div>`;
  }
  function repaintReader() {
    // Re-render only the reader from cache (no network) so a tap feels instant.
    const el = $("#reader"); if (!el) return;
    const chunk = el.dataset.chunk ? JSON.parse(el.dataset.chunk) : null;
    if (chunk) mountReader(chunk); else { const r = currentReading(); if (r) mountReader(r.chunk); }
  }
  ACT.fontSize = (el) => {
    const v = Math.min(1.6, Math.max(0.85, +(readerFs() + 0.1 * +el.dataset.v).toFixed(2)));
    try { localStorage.setItem("abide.fs", v); } catch (e) {}
    const r = $("#reader"); if (r) r.style.fontSize = v + "rem";
  };
  ACT.tapVerse = (el) => {
    const ref = el.dataset.ref;
    if (selVerse && selVerse.ref === ref) selVerse = null;
    else {
      const span = el.closest(".verse") || el;
      selVerse = { ref, tr: el.dataset.tr || selVerse?.tr || "", text: span.textContent.replace(/^\d+/, "").trim() };
    }
    repaintReader();
  };
  ACT.saveVerse = () => {
    if (!selVerse) return;
    if (list("verses").some((x) => x.ref === selVerse.ref)) return toast("Already saved");
    put("verses", { id: uid(), ref: selVerse.ref, text: selVerse.text, translation: selVerse.tr, created: nowIso() });
    toast("Verse saved ♥"); repaintReader();
  };
  ACT.verseToPrayer = () => {
    if (!selVerse) return;
    addPrayer("S", `${selVerse.ref} — “${selVerse.text.length > 120 ? selVerse.text.slice(0, 117) + "…" : selVerse.text}”`, { from: selVerse.ref });
    toast("Added as a prayer point");
  };
  ACT.copyVerse = async () => {
    if (!selVerse) return;
    try { await navigator.clipboard.writeText(`“${selVerse.text}” — ${selVerse.ref} (${selVerse.tr})`); toast("Copied"); } catch (e) { toast("Copy not available"); }
  };

  // Browse any chapter
  let browse = { book: "John", ch: 1 };
  function browseBox() {
    return `
    <div class="card flat">
      <div class="eyebrow">Browse</div>
      <div class="row">
        <select data-change="browseBook" style="flex:2">${C.books.map(([b]) => `<option ${b === browse.book ? "selected" : ""}>${b}</option>`).join("")}</select>
        <select id="browse-ch" data-change="browseCh" style="flex:1">${Array.from({ length: bookChapters(browse.book) }, (_, i) => `<option value="${i + 1}" ${i + 1 === browse.ch ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
        <button class="btn-primary" data-act="browseGo">Read</button>
      </div>
    </div>`;
  }
  ACT.browseBook = (el) => {
    browse.book = el.value; browse.ch = 1;
    const chSel = $("#browse-ch");
    if (chSel) chSel.innerHTML = Array.from({ length: bookChapters(browse.book) }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  };
  ACT.browseCh = (el) => { browse.ch = +el.value; };
  ACT.browseGo = () => {
    const book = $("[data-change=browseBook]")?.value || browse.book;
    const ch = +($("#browse-ch")?.value || browse.ch || 1);
    browse = { book, ch };
    location.hash = `#read/${encodeURIComponent(book)}/${ch}`;
  };

  routes.read = (book, ch) => {
    if (!book || !bookChapters(book)) return routes.bible();
    ch = Math.max(1, Math.min(bookChapters(book), +ch || 1));
    if (browse.hash !== location.hash) browse = { book, ch, hash: location.hash };
    const idx = C.books.findIndex((b) => b[0] === book);
    const prev = ch > 1 ? `#read/${encodeURIComponent(book)}/${ch - 1}` : idx > 0 ? `#read/${encodeURIComponent(C.books[idx - 1][0])}/${C.books[idx - 1][1]}` : null;
    const next = ch < bookChapters(book) ? `#read/${encodeURIComponent(book)}/${ch + 1}` : idx < C.books.length - 1 ? `#read/${encodeURIComponent(C.books[idx + 1][0])}/1` : null;
    return `
    <div class="stack">
      <div class="row between">
        <div><a href="#bible" class="tiny">← Bible</a><h1>${esc(displayBook(book))} ${ch}</h1></div>
        ${readerTools()}
      </div>
      <div class="card">
        <div id="reader" class="reader" style="font-size:${readerFs()}rem" data-chunk='${JSON.stringify([{ book, ch }])}'><div class="empty">Loading…</div></div>
      </div>
      <div class="row between">
        ${prev ? `<a class="btn" href="${prev}">← previous</a>` : "<span></span>"}
        <a class="btn btn-sm" href="${bibleUrl(`${displayBook(book)} ${ch}`)}" target="_blank" rel="noopener">${esc(translation())} ↗</a>
        ${next ? `<a class="btn" href="${next}">next →</a>` : "<span></span>"}
      </div>
      ${browseBox()}
    </div>`;
  };
  afterRender.read = (book, ch) => { if (book && bookChapters(book)) mountReader([{ book, ch: Math.max(1, Math.min(bookChapters(book), +ch || 1)) }]); };

  // Saved verses
  routes.verses = () => {
    const items = list("verses").sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    return `
    <div class="stack">
      <div class="row between"><h1>Saved verses</h1><a href="#bible" class="btn btn-ghost btn-sm">← Bible</a></div>
      <p class="muted">Verses you tapped while reading. Reread them, pray them, let them sink in.</p>
      ${items.length === 0 ? `<div class="empty">Nothing saved yet. While reading, tap a verse and choose ♥ Save.</div>` : ""}
      ${items.map((v) => {
        const m = v.ref.match(/^(.*) (\d+):(\d+)$/); const book = m ? (m[1] === "Psalm" ? "Psalms" : m[1]) : null;
        return `
        <div class="card verse-card">
          <div class="verse-quote">“${esc(v.text).replace(/\n/g, "<br>")}”</div>
          <div class="row between" style="margin-top:8px">
            <div class="tiny"><b>${esc(v.ref)}</b> ${esc(v.translation || "")} · saved ${relDate(v.created)}</div>
            <div class="row" style="gap:4px">
              ${book ? `<a class="btn btn-sm" href="#read/${encodeURIComponent(book)}/${m[2]}">open</a>` : ""}
              <button class="btn-sm" data-act="savedToPrayer" data-id="${v.id}">🙏 pray</button>
              <button class="btn-sm btn-danger" data-act="delVerse" data-id="${v.id}">delete</button>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  };
  ACT.savedToPrayer = (el) => { const v = S.data.verses[el.dataset.id]; addPrayer("S", `${v.ref} — “${v.text.length > 120 ? v.text.slice(0, 117) + "…" : v.text}”`, { from: v.ref }); toast("Added as a prayer point"); };
  ACT.delVerse = (el) => { remove("verses", el.dataset.id); };

  // Offline download of the whole WEB text (service worker caches each chapter)
  ACT.downloadBible = async (el) => {
    el.disabled = true;
    const all = []; C.books.forEach(([b, n]) => { for (let i = 1; i <= n; i++) all.push(`data/bible/web/${bookSlug(b)}/${i}.json`); });
    let done = 0, failed = 0;
    const worker = async () => { while (all.length) { const u = all.shift(); try { const r = await fetch(u); if (!r.ok) failed++; } catch (e) { failed++; } done++; if (done % 100 === 0) el.textContent = `Downloading… ${done}/1189`; } };
    await Promise.all(Array.from({ length: 6 }, worker));
    el.textContent = failed ? `Done, ${failed} chapters missing` : "Bible available offline ✓";
    toast(failed ? "Some chapters missing — has the Bible workflow run?" : "Whole Bible cached for offline reading");
  };

  function renderPlanPicker(r) {
    const tr = translation();
    const custom = settings().customDraft || { books: ["Romans"], perDay: 1 };
    const cn = planReadings(custom).length;
    return `
    <div class="stack">
      <div class="row between"><h1>Reading plan</h1>${r ? `<button class="btn-sm btn-ghost" data-act="planPickerClose">← back</button>` : ""}</div>
      <p class="muted">Pick a plan. Today’s reading is always the next one you haven’t done — no catch-up guilt.</p>
      ${C.plans.map((p) => `
        <div class="card ${r?.plan.id === p.id ? "flat" : ""}">
          <div class="row between">
            <div><h3>${esc(p.name)}</h3><div class="small muted">${esc(p.desc)}</div></div>
            ${r?.plan.id === p.id ? `<span class="pill pill-ok">current</span>` : `<button class="btn-sm btn-primary" data-act="startPlan" data-id="${p.id}">Start</button>`}
          </div>
          ${r?.plan.id === p.id ? `<div class="row" style="margin-top:8px"><button class="btn-sm" data-act="restartPlan">restart from the beginning</button></div>` : ""}
        </div>`).join("")}
      <div class="card">
        <h3>Custom plan</h3>
        <div class="small muted">Any book or run of books, at your own pace.</div>
        <div class="row" style="margin-top:10px">
          <select id="custom-book" data-change="customBook" style="flex:1">${C.books.map(([b]) => `<option ${custom.books[0] === b ? "selected" : ""}>${b}</option>`).join("")}</select>
          <select id="custom-to" data-change="customBook">${["(this book only)", ...C.books.map(([b]) => b)].map((b, i) => `<option value="${i ? b : ""}" ${(custom.books.length > 1 ? custom.books[custom.books.length - 1] : "") === (i ? b : "") ? "selected" : ""}>${i ? "through " + b : b}</option>`).join("")}</select>
        </div>
        <div class="row" style="margin-top:10px">
          <span class="small">Chapters per day</span>
          <div class="seg">${[1, 2, 3].map((n) => `<button class="${custom.perDay === n ? "on" : ""}" data-act="customPer" data-v="${n}">${n}</button>`).join("")}</div>
          <span class="tiny" id="custom-days">= ${cn} day${cn === 1 ? "" : "s"}</span>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn-primary" data-act="startCustom" ${cn ? "" : "disabled"}>Start custom plan</button></div>
      </div>
      ${browseBox()}
      <div class="card flat">
        <div class="eyebrow">Translation</div>
        <select data-change="setTranslation">${C.translations.map(([k, n]) => `<option value="${k}" ${k === tr ? "selected" : ""}>${k} — ${n}</option>`).join("")}</select>
        <div class="tiny" style="margin-top:6px">Passages open on BibleGateway in this version.</div>
      </div>
    </div>`;
  }

  function lensFields(vals = {}) {
    return C.lens.map((q) => `
      <label class="field">
        <span>${esc(q.label)}</span>
        <span class="hint">${esc(q.hint)}</span>
        <textarea data-lens="${q.key}" placeholder="…">${esc(vals?.[q.key] || "")}</textarea>
      </label>`).join("");
  }

  ACT.planPicker = () => { planPicker = true; render(); };
  ACT.planPickerClose = () => { planPicker = false; render(); };
  ACT.startPlan = (el) => {
    const p = C.plans.find((x) => x.id === el.dataset.id);
    settings().plan = { id: p.id, name: p.name, books: p.books, perDay: p.perDay, progress: 0, started: today() };
    planPicker = false; saveSettings(); toast(`Started: ${p.name}`);
  };
  ACT.restartPlan = () => { if (confirm("Restart this plan from the beginning?")) { settings().plan.progress = 0; settings().plan.started = today(); planPicker = false; saveSettings(); } };
  function customBooks() {
    const from = $("#custom-book")?.value, to = $("#custom-to")?.value;
    const names = C.books.map(([b]) => b);
    const a = names.indexOf(from), b = to ? names.indexOf(to) : a;
    return b >= a ? names.slice(a, b + 1) : [from];
  }
  ACT.customBook = () => {
    const c = settings().customDraft || { perDay: 1 }; c.books = customBooks(); settings().customDraft = c; saveLocal();
    const n = planReadings(c).length; const lab = $("#custom-days"); if (lab) lab.textContent = `= ${n} day${n === 1 ? "" : "s"}`;
  };
  ACT.customPer = (el) => { const c = settings().customDraft || { books: ["Romans"] }; c.books = customBooks(); c.perDay = +el.dataset.v; settings().customDraft = c; emit(); };
  ACT.startCustom = () => {
    const c = settings().customDraft || { books: ["Romans"], perDay: 1 };
    const name = c.books.length === 1 ? c.books[0] : `${c.books[0]} → ${c.books[c.books.length - 1]}`;
    settings().plan = { id: "custom-" + uid(), name, books: c.books, perDay: c.perDay, progress: 0, started: today() };
    planPicker = false; saveSettings(); toast(`Started: ${name}`);
  };
  ACT.setTranslation = (el) => { settings().translation = el.value; saveSettings(); };
  ACT.markRead = () => {
    const r = currentReading(); if (!r || r.finished) return;
    const d = day();
    d.readingsDone = d.readingsDone || []; d.readingsDone.push(r.ref);
    settings().plan.progress = r.index + 1;
    saveDay(d); saveSettings(); toast("Read ✓ — now reflect");
  };

  // ------------------------------------------------------------ DEVOTIONAL
  let devFilter = "all";
  routes.devotional = () => {
    const d = day();
    const feed = S.feed;
    if (!feed) return `<div class="empty">Loading today’s devotionals…</div>`;
    const hidden = new Set(S.data.settings.hiddenSources || []);
    const sources = feed.sources.filter((s) => !hidden.has(s.id) && (devFilter === "all" || s.kind === devFilter));
    const gen = feed.generated ? `Updated ${relDate(feed.generated)}` : "No feed yet — run the GitHub Action";

    return `
    <div class="stack">
      <div class="row between">
        <div><h1>Read or listen</h1><div class="tiny">${esc(gen)}</div></div>
        <div class="seg">
          <button class="${devFilter === "all" ? "on" : ""}" data-act="devFilter" data-v="all">All</button>
          <button class="${devFilter === "read" ? "on" : ""}" data-act="devFilter" data-v="read">Read</button>
          <button class="${devFilter === "listen" ? "on" : ""}" data-act="devFilter" data-v="listen">Listen</button>
        </div>
      </div>

      ${d.devotional ? renderReflection(d) : `<p class="muted">Choose one. It opens in a new tab and becomes today’s reading — then come back here to reflect on it with a gospel lens.</p>`}

      ${sources.length === 0 ? `<div class="empty">Nothing to show. ${hidden.size ? "Some sources are hidden in Settings." : ""}</div>` : ""}
      ${sources.map((s) => `
        <div>
          <div class="source-head">
            <h3>${esc(s.name)}</h3>
            <span class="tiny">${esc(s.speaker)}${s.error ? " · ⚠ last fetch failed" : ""}</span>
          </div>
          ${(s.items || []).slice(0, 5).map((it, i) => {
            const picked = d.devotional && d.devotional.link === it.link;
            return `
            <a class="item ${picked ? "picked" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-act="pick" data-src="${esc(s.id)}" data-i="${i}">
              <div class="item-kind">${s.kind === "read" ? "📖" : "🎧"}</div>
              <div class="item-body">
                <div class="item-title">${esc(it.title)}</div>
                <div class="item-meta">${esc(fmtDate(it.date))}${it.duration ? " · " + esc(it.duration) : ""}${picked ? " · today’s pick ✓" : ""}</div>
                ${it.summary ? `<div class="item-sum">${esc(it.summary)}</div>` : ""}
              </div>
            </a>`;
          }).join("")}
        </div>`).join("")}
    </div>`;
  };

  function renderReflection(d) {
    const dev = d.devotional;
    const lens = d.lens || {};
    return `
    <div class="card">
      <div class="eyebrow">Today’s reading</div>
      <h2><a href="${esc(dev.link)}" target="_blank" rel="noopener">${esc(dev.title)}</a></h2>
      <div class="tiny">${esc(dev.sourceName)} · <a href="#" data-act="unpick">choose a different one</a></div>
      <hr class="divider">
      <div class="eyebrow">Gospel lens</div>
      ${lensFields(lens)}
      <div class="row">
        <button class="btn-primary" data-act="saveLens" data-target="lens">Save reflection</button>
        <button data-act="lensToPrayer" data-target="lens" data-from="${esc(dev.title)}">Turn response into a prayer point</button>
      </div>
    </div>`;
  }

  ACT.devFilter = (el) => { devFilter = el.dataset.v; render(); };
  ACT.pick = (el) => {
    const src = S.feed.sources.find((s) => s.id === el.dataset.src);
    const it = src.items[+el.dataset.i];
    const d = day();
    d.devotional = { sourceId: src.id, sourceName: src.name, kind: src.kind, title: it.title, link: it.link, pickedAt: nowIso() };
    saveDay(d);
    toast("Set as today’s reading");
  };
  ACT.unpick = () => { const d = day(); delete d.devotional; delete d.lens; saveDay(d); };
  ACT.saveLens = (el) => {
    const target = el?.dataset?.target || "lens";
    const d = day();
    d[target] = {};
    $$("[data-lens]").forEach((t) => (d[target][t.dataset.lens] = t.value.trim()));
    saveDay(d); toast("Reflection saved");
  };
  ACT.lensToPrayer = (el) => {
    const text = ($("[data-lens=response]")?.value || "").trim();
    if (!text) return toast("Write a response first");
    ACT.saveLens(el);
    addPrayer("S", text, { from: "reading: " + (el.dataset.from || "") });
    toast("Added to prayer points");
  };

  // ------------------------------------------------------------ prayer groups
  const focusGroups = (wd = new Date().getDay()) => groups().filter((g) => (g.days || []).includes(wd));
  const groupName = (id) => groups().find((g) => g.id === id)?.name || "";
  const countOpenFor = (gs) => list("prayers").filter((p) => p.status !== "answered" && gs.some((g) => g.id === p.who)).length;
  function whoSelect(current, attrs = "") {
    return `<select ${attrs}><option value="">— no group —</option>${groups().map((g) => `<option value="${g.id}" ${g.id === current ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>`;
  }

  // ------------------------------------------------------------ PRAY (ACTS)
  routes.pray = (step) => {
    const d = day();
    const k = ["A", "C", "T", "S"].includes(step) ? step : nextStep(d);
    const cat = C.acts[k];
    const prompt = seededPick(cat.prompts, today() + k + (d.promptShift?.[k] || 0));
    const allPoints = list("prayers").filter((p) => p.cat === k && p.status !== "answered").sort(byStale);
    const focus = k === "S" ? focusGroups() : [];
    const focusIds = new Set(focus.map((g) => g.id));
    const focusPts = allPoints.filter((p) => focusIds.has(p.who));
    const points = k === "S" && focus.length ? allPoints.filter((p) => !focusIds.has(p.who)) : allPoints;
    const wd = new Date().getDay();

    return `
    <div class="stack">
      <div class="row between"><h1>Pray</h1><a href="#quiet/${k}" class="btn btn-sm">◷ ${settings().timerMin || 5}-min quiet prayer</a></div>
      <div class="acts-steps">
        ${["A", "C", "T", "S"].map((x) => `<button class="${x} ${x === k ? "on" : ""} ${d.acts?.[x] ? "done" : ""}" data-act="step" data-v="${x}" title="${C.acts[x].name}">${x}</button>`).join("")}
      </div>

      <div class="card">
        <div class="row between">
          <div><span class="pill pill-${k}">${cat.name}</span></div>
          <button class="btn-sm btn-ghost" data-act="shuffle" data-v="${k}">another prompt ↻</button>
        </div>
        <h2 style="margin-top:8px">${esc(cat.tagline)}</h2>
        <p class="small muted" style="margin-top:6px"><em>“${esc(cat.verse.text)}”</em> — ${esc(cat.verse.ref)}</p>
        <div class="prompt-box">${esc(prompt)}</div>
        <label class="field" style="margin-top:12px">
          <span>${k === "S" ? "Add a prayer point" : "Write it out (optional)"}</span>
          <textarea id="pray-text" placeholder="${esc(cat.placeholder)}"></textarea>
        </label>
        ${k === "S" ? `<label class="field"><span>For whom</span>${whoSelect(focus[0]?.id || "", 'id="pray-who"')}</label>` : ""}
        <div class="row">
          <button data-act="addPoint" data-v="${k}">${esc(cat.saveLabel)}</button>
          <button class="btn-primary" data-act="markDone" data-v="${k}">${d.acts?.[k] ? "Done ✓ — next" : "Amen, next →"}</button>
        </div>
      </div>

      ${k === "S" && focus.length ? `
      <div class="card">
        <div class="row between">
          <div class="eyebrow" style="margin:0">${esc(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd])}’s focus · ${focus.map((g) => esc(g.name)).join(" · ")}</div>
          <a href="#settings" class="tiny">rotation</a>
        </div>
        ${focusPts.length ? focusPts.map((p) => renderPoint(p)).join("") : `<div class="empty">No open points for this group yet — add one above.</div>`}
      </div>` : ""}

      ${points.length ? `
      <div class="card flat">
        <div class="row between">
          <div class="eyebrow" style="margin:0">${k === "S" ? (focus.length ? "Everyone else" : "Prayer points") : cat.name + " — kept points"}</div>
          <a href="#prayers" class="tiny">all points →</a>
        </div>
        ${points.map((p) => renderPoint(p)).join("")}
      </div>` : (allPoints.length ? "" : `<div class="empty">No ${cat.name.toLowerCase()} points kept yet. Anything you write above can be kept and prayed again.</div>`)}
    </div>`;
  };

  let noteFor = null, answerFor = null, moveFor = null;
  const byStale = (a, b) => (a.lastPrayed || "").localeCompare(b.lastPrayed || "");
  function nextStep(d) { return ["A", "C", "T", "S"].find((k) => !d.acts?.[k]) || "S"; }

  function renderPoint(p, showCat = false) {
    const d = day();
    const prayedToday = (d.prayed || []).includes(p.id);
    const answered = p.status === "answered";
    const who = p.who ? groupName(p.who) : "";
    return `
    <div class="point" data-id="${p.id}">
      <input type="checkbox" ${prayedToday ? "checked" : ""} ${answered ? "disabled" : ""} data-change="prayed" data-id="${p.id}" title="Prayed today">
      <div class="point-body">
        <div class="point-text ${answered ? "answered" : ""}">${showCat ? `<span class="pill pill-${p.cat}" style="margin-right:6px">${p.cat}</span>` : ""}${esc(p.text)}</div>
        <div class="point-meta">${who ? `<span class="who">${esc(who)}</span> · ` : ""}${answered ? "answered " + relDate(p.answeredAt) : `added ${relDate(p.created)} · prayed ${p.prayedCount || 0}× · last ${p.lastPrayed ? relDate(p.lastPrayed) : "never"}`}${p.from ? " · from " + esc(p.from) : ""}</div>
        ${(p.notes || []).length ? `<div class="point-notes">${p.notes.map((n) => `<div><span class="tiny">${esc(fmtDate(n.date))}</span> ${esc(n.text)}</div>`).join("")}</div>` : ""}
        ${answered && p.answer ? `<div class="point-answer">“${esc(p.answer)}”</div>` : ""}
        ${noteFor === p.id ? `<div class="row" style="margin-top:6px"><input type="text" id="note-input" placeholder="Update on this prayer…" style="flex:1"><button class="btn-sm btn-primary" data-act="saveNote" data-id="${p.id}">Save</button><button class="btn-sm" data-act="cancelNote">Cancel</button></div>` : ""}
        ${answerFor === p.id ? `<div class="answer-box"><div class="small" style="font-weight:600;margin-bottom:6px">Praise God. How did he answer?</div><input type="text" id="answer-input" placeholder="optional — a line you’ll want to reread later"><div class="row" style="margin-top:6px"><button class="btn-sm btn-primary" data-act="saveAnswer" data-id="${p.id}">Mark answered</button><button class="btn-sm" data-act="cancelAnswer">Cancel</button></div></div>` : ""}
        ${moveFor === p.id ? `<div class="row" style="margin-top:6px">${whoSelect(p.who, `data-change="setWho" data-id="${p.id}" style="flex:1"`)}<button class="btn-sm" data-act="cancelMove">Done</button></div>` : ""}
        <div class="point-actions">
          <button data-act="addNote" data-id="${p.id}">+ note</button>
          ${answered ? `<button data-act="reopen" data-id="${p.id}">reopen</button>` : `<button data-act="answered" data-id="${p.id}">answered ✓</button>`}
          ${p.cat === "S" && !answered ? `<button data-act="move" data-id="${p.id}">${who ? "group" : "+ group"}</button>` : ""}
          <button class="btn-danger" data-act="delPoint" data-id="${p.id}">delete</button>
        </div>
      </div>
    </div>`;
  }

  function addPrayer(cat, text, extra = {}) {
    return put("prayers", { id: uid(), cat, text, notes: [], status: "open", created: nowIso(), lastPrayed: null, prayedCount: 0, ...extra });
  }

  ACT.step = (el) => { location.hash = "#pray/" + el.dataset.v; };
  ACT.shuffle = (el) => { const d = day(); d.promptShift = d.promptShift || {}; d.promptShift[el.dataset.v] = (d.promptShift[el.dataset.v] || 0) + 1; saveDay(d); };
  ACT.addPoint = (el) => {
    const t = $("#pray-text"); const text = t.value.trim();
    if (!text) return toast("Write something first");
    const who = $("#pray-who")?.value || "";
    addPrayer(el.dataset.v, text, who ? { who } : {}); t.value = ""; toast("Kept");
  };
  ACT.markDone = (el) => {
    const k = el.dataset.v; const d = day();
    d.acts = d.acts || {}; d.acts[k] = true;
    const t = $("#pray-text"); if (t && t.value.trim()) addPrayer(k, t.value.trim());
    saveDay(d);
    const next = ["A", "C", "T", "S"].find((x) => !d.acts[x]);
    if (next) location.hash = "#pray/" + next; else { toast("Amen. All four done today 🙏"); location.hash = "#home"; }
  };
  ACT.prayed = (el) => {
    const p = S.data.prayers[el.dataset.id]; const d = day();
    d.prayed = d.prayed || [];
    if (el.checked) {
      if (!d.prayed.includes(p.id)) d.prayed.push(p.id);
      p.lastPrayed = nowIso(); p.prayedCount = (p.prayedCount || 0) + 1;
    } else {
      d.prayed = d.prayed.filter((x) => x !== p.id); p.prayedCount = Math.max(0, (p.prayedCount || 1) - 1);
    }
    put("prayers", p); saveDay(d);
  };
  ACT.addNote = (el) => { noteFor = el.dataset.id; render(); $("#note-input")?.focus(); };
  ACT.cancelNote = () => { noteFor = null; render(); };
  ACT.saveNote = (el) => {
    const p = S.data.prayers[el.dataset.id];
    const text = ($("#note-input")?.value || "").trim();
    if (!text) return toast("Write a note first");
    p.notes = p.notes || []; p.notes.push({ date: today(), text });
    noteFor = null; put("prayers", p); toast("Note added"); render();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "note-input") { e.preventDefault(); ACT.saveNote({ dataset: { id: noteFor } }); }
  });
  ACT.answered = (el) => { answerFor = el.dataset.id; noteFor = null; render(); $("#answer-input")?.focus(); };
  ACT.cancelAnswer = () => { answerFor = null; render(); };
  ACT.saveAnswer = (el) => {
    const p = S.data.prayers[el.dataset.id];
    const text = ($("#answer-input")?.value || "").trim();
    p.status = "answered"; p.answeredAt = nowIso(); if (text) p.answer = text;
    answerFor = null; put("prayers", p); toast("Praise God 🙌"); render();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "answer-input") { e.preventDefault(); ACT.saveAnswer({ dataset: { id: answerFor } }); }
  });
  ACT.reopen = (el) => { const p = S.data.prayers[el.dataset.id]; p.status = "open"; delete p.answeredAt; put("prayers", p); };
  ACT.move = (el) => { moveFor = el.dataset.id; render(); };
  ACT.cancelMove = () => { moveFor = null; render(); };
  ACT.setWho = (el) => { const p = S.data.prayers[el.dataset.id]; p.who = el.value || null; moveFor = null; put("prayers", p); render(); };
  ACT.delPoint = (el) => { if (confirm("Delete this prayer point?")) remove("prayers", el.dataset.id); };

  // ------------------------------------------------------------ PRAYERS list
  let prayFilter = "open";
  routes.prayers = () => {
    const all = list("prayers");
    const items = all.filter((p) => (prayFilter === "answered" ? p.status === "answered" : p.status !== "answered")).sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    const groups = { S: [], A: [], C: [], T: [] };
    items.forEach((p) => groups[p.cat]?.push(p));
    return `
    <div class="stack">
      <div class="row between">
        <h1>Prayer points</h1>
        <div class="seg">
          <button class="${prayFilter === "open" ? "on" : ""}" data-act="prayFilter" data-v="open">Open</button>
          <button class="${prayFilter === "answered" ? "on" : ""}" data-act="prayFilter" data-v="answered">Answered</button>
        </div>
      </div>
      <div class="card flat">
        <label class="field"><span>Quick add (supplication)</span><input type="text" id="quick-prayer" placeholder="Type a prayer point and press Enter" data-act="noop"></label>
      </div>
      ${items.length === 0 ? `<div class="empty">${prayFilter === "open" ? "No open prayer points." : "No answered prayers recorded yet."}</div>` : ""}
      ${prayFilter === "answered" && items.length ? `<a href="#answered" class="btn btn-block" style="text-align:center">See the answered-prayer wall →</a>` : ""}
      ${groups.S.length ? (() => {
        const byWho = {};
        groups.S.forEach((p) => (byWho[p.who || ""] = byWho[p.who || ""] || []).push(p));
        const order = [...groups_().map((g) => g.id), ""].filter((id) => byWho[id]);
        return order.map((id) => `
          <div class="card flat">
            <div class="eyebrow"><span class="pill pill-S">Supplication</span> &nbsp;${id ? esc(groupName(id)) : "No group"}</div>
            ${byWho[id].map((p) => renderPoint(p)).join("")}
          </div>`).join("");
      })() : ""}
      ${["A", "C", "T"].filter((k) => groups[k].length).map((k) => `
        <div class="card flat">
          <div class="eyebrow"><span class="pill pill-${k}">${C.acts[k].name}</span></div>
          ${groups[k].map((p) => renderPoint(p)).join("")}
        </div>`).join("")}
      <a href="#pray" class="btn btn-block btn-primary" style="text-align:center">Pray through ACTS →</a>
    </div>`;
  };
  const groups_ = groups; // alias (routes.prayers shadows `groups` locally)
  ACT.prayFilter = (el) => { prayFilter = el.dataset.v; render(); };
  ACT.noop = () => {};

  // ------------------------------------------------------------ ANSWERED WALL
  routes.answered = () => {
    const items = list("prayers").filter((p) => p.status === "answered").sort((a, b) => (b.answeredAt || "").localeCompare(a.answeredAt || ""));
    const span = (p) => { const n = p.answeredAt && p.created ? Math.max(1, Math.round((new Date(p.answeredAt) - new Date(p.created)) / 864e5)) : null; return n ? `${n} day${n === 1 ? "" : "s"}` : ""; };
    return `
    <div class="stack">
      <h1>Answered</h1>
      <p class="muted">“Till now the Lord has helped us.” — 1 Samuel 7:12. A wall to walk past on hard days.</p>
      ${items.length === 0 ? `<div class="empty">Nothing here yet. When a prayer is answered, mark it ✓ and write a line about how — it will appear here.</div>` : ""}
      ${items.map((p) => `
        <div class="card stone">
          <div class="tiny">${esc(fmtDate(p.answeredAt, { day: "numeric", month: "long", year: "numeric" }))}${p.who ? " · " + esc(groupName(p.who)) : ""}${span(p) ? " · prayed over " + span(p) : ""}${p.prayedCount ? ", " + p.prayedCount + "×" : ""}</div>
          <div class="stone-text">${esc(p.text)}</div>
          ${p.answer ? `<div class="stone-answer">${esc(p.answer)}</div>` : ""}
          ${(p.notes || []).length ? `<details><summary>journey (${p.notes.length} note${p.notes.length === 1 ? "" : "s"})</summary><div class="point-notes" style="margin-top:6px">${p.notes.map((n) => `<div><span class="tiny">${esc(fmtDate(n.date))}</span> ${esc(n.text)}</div>`).join("")}</div></details>` : ""}
          <div class="point-actions" style="margin-top:8px"><button data-act="editAnswer" data-id="${p.id}">${p.answer ? "edit" : "+ how God answered"}</button><button data-act="reopen" data-id="${p.id}">reopen</button></div>
          ${answerFor === p.id ? `<div class="answer-box"><input type="text" id="answer-input" value="${esc(p.answer || "")}" placeholder="How did God answer?"><div class="row" style="margin-top:6px"><button class="btn-sm btn-primary" data-act="saveAnswer" data-id="${p.id}">Save</button><button class="btn-sm" data-act="cancelAnswer">Cancel</button></div></div>` : ""}
        </div>`).join("")}
    </div>`;
  };
  ACT.editAnswer = (el) => { answerFor = el.dataset.id; render(); $("#answer-input")?.focus(); };

  // ------------------------------------------------------------ QUIET TIMER
  const T = { total: 0, left: 0, running: false, iv: null, ctx: null, lock: null, k: null, done: false, started: false };
  routes.quiet = (arg) => {
    const k = ["A", "C", "T", "S"].includes(arg) ? arg : null;
    if (T.k !== k) { stopTimer(); T.k = k; }
    const d = day();
    const cat = k ? C.acts[k] : null;
    const mins = settings().timerMin || 5;
    const focus = focusGroups();
    const focusIds = new Set(focus.map((g) => g.id));
    const pts = list("prayers").filter((p) => p.status !== "answered" && (k ? p.cat === k : p.cat === "S")).sort((a, b) => (focusIds.has(b.who) - focusIds.has(a.who)) || byStale(a, b)).slice(0, 6);
    const prompt = cat ? seededPick(cat.prompts, today() + k + (d.promptShift?.[k] || 0) + (T.shift || 0)) : "Be still, and know that I am God.";
    document.body.classList.add("quiet-mode");
    return `
    <div class="quiet">
      <a href="#pray${k ? "/" + k : ""}" class="quiet-close" aria-label="Close">✕</a>
      <div class="quiet-top">${cat ? `<span class="pill pill-${k}">${cat.name}</span>` : `<span class="pill pill-muted">Quiet</span>`}</div>
      <div class="quiet-prompt">${esc(prompt)}</div>
      ${cat ? `<button class="btn-ghost btn-sm" data-act="quietShuffle">another prompt ↻</button>` : ""}
      <div class="ring-wrap">
        <svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="54" class="ring-bg"/><circle cx="60" cy="60" r="54" class="ring-fg" id="ring-fg"/></svg>
        <div class="ring-time" id="ring-time">${pad(mins)}:00</div>
      </div>
      ${!T.started ? `
        <div class="seg">${[3, 5, 10, 15].map((m) => `<button class="${mins === m ? "on" : ""}" data-act="setMins" data-v="${m}">${m} min</button>`).join("")}</div>
        <button class="btn-primary btn-lg" data-act="beginTimer">Begin</button>
        <div class="tiny">The screen stays on. A soft chime marks the end.</div>`
      : T.done ? `
        <div class="quiet-amen">Amen.</div>
        <button class="btn-primary btn-lg" data-act="finishTimer">${k ? `Mark ${cat.name} done →` : "Done"}</button>
        <button class="btn-ghost btn-sm" data-act="beginTimer">Another ${mins} minutes</button>`
      : `
        <div class="row" style="justify-content:center">
          <button data-act="pauseTimer" id="pause-btn">${T.running ? "Pause" : "Resume"}</button>
          <button class="btn-primary" data-act="endEarly">Amen — finish</button>
        </div>`}
      ${pts.length ? `<div class="quiet-list"><div class="eyebrow">Bring these</div>${pts.map((p) => `<div class="quiet-pt">${focusIds.has(p.who) ? "★ " : ""}${esc(p.text)}</div>`).join("")}</div>` : ""}
    </div>`;
  };
  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#quiet")) { stopTimer(); document.body.classList.remove("quiet-mode"); } });

  function paintTimer() {
    const fg = $("#ring-fg"), tm = $("#ring-time"); if (!fg || !tm) return;
    const circ = 2 * Math.PI * 54;
    fg.style.strokeDasharray = circ; fg.style.strokeDashoffset = circ * (1 - T.left / T.total);
    tm.textContent = `${pad(Math.floor(T.left / 60))}:${pad(Math.ceil(T.left % 60))}`;
  }
  function tick() {
    if (!T.running) return;
    T.left = Math.max(0, T.endAt - Date.now()) / 1000;
    paintTimer();
    if (T.left <= 0) { T.running = false; clearInterval(T.iv); T.done = true; chime(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); render(); }
  }
  function stopTimer() { clearInterval(T.iv); T.running = false; T.started = false; T.done = false; T.shift = 0; T.lock?.release?.().catch(() => {}); T.lock = null; }
  function chime() {
    try {
      const ctx = T.ctx || (T.ctx = new (window.AudioContext || window.webkitAudioContext)());
      [[523.25, 0], [659.25, 0.35], [783.99, 0.7]].forEach(([f, t]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        const s = ctx.currentTime + t; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.25, s + 0.05); g.gain.exponentialRampToValueAtTime(0.001, s + 1.6);
        o.start(s); o.stop(s + 1.7);
      });
    } catch (e) { /* audio not available */ }
  }
  ACT.setMins = (el) => { settings().timerMin = +el.dataset.v; saveSettings(); };
  ACT.quietShuffle = () => { T.shift = (T.shift || 0) + 1; render(); if (T.started && !T.done) paintTimer(); };
  ACT.beginTimer = async () => {
    const mins = settings().timerMin || 5;
    try { T.ctx = T.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (T.ctx.state === "suspended") T.ctx.resume(); } catch (e) {}
    try { T.lock = await navigator.wakeLock?.request("screen"); } catch (e) {}
    T.total = mins * 60; T.left = T.total; T.endAt = Date.now() + T.total * 1000; T.running = true; T.started = true; T.done = false;
    clearInterval(T.iv); T.iv = setInterval(tick, 250);
    render(); paintTimer();
  };
  ACT.pauseTimer = () => {
    if (T.running) { T.running = false; clearInterval(T.iv); T.pausedLeft = T.left; }
    else { T.running = true; T.endAt = Date.now() + T.pausedLeft * 1000; T.iv = setInterval(tick, 250); }
    const b = $("#pause-btn"); if (b) b.textContent = T.running ? "Pause" : "Resume";
  };
  ACT.endEarly = () => { T.running = false; clearInterval(T.iv); T.done = true; render(); };
  ACT.finishTimer = () => {
    const d = day(); const mins = Math.max(1, Math.round((T.total - T.left) / 60));
    d.quietMin = (d.quietMin || 0) + mins;
    if (T.k) { d.acts = d.acts || {}; d.acts[T.k] = true; }
    saveDay(d);
    const k = T.k; stopTimer(); document.body.classList.remove("quiet-mode");
    const next = k ? ["A", "C", "T", "S"].find((x) => !d.acts[x]) : null;
    toast(`${mins} quiet minute${mins === 1 ? "" : "s"} 🙏`);
    location.hash = next ? "#pray/" + next : "#home";
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "quick-prayer" && e.target.value.trim()) {
      addPrayer("S", e.target.value.trim()); e.target.value = ""; toast("Added"); render(); $("#quick-prayer")?.focus();
    }
  });

  // ------------------------------------------------------------ RECAP
  let recapDraft = null;
  routes.recap = (arg) => (arg === "new" || (arg && S.data.recaps[arg]) ? recapForm(arg === "new" ? null : S.data.recaps[arg]) : recapList());

  function recapList() {
    const items = list("recaps").sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || "").localeCompare(a.created || ""));
    return `
    <div class="stack">
      <div class="row between">
        <h1>Recaps</h1>
        <a href="#recap/new" class="btn btn-primary">+ New recap</a>
      </div>
      <p class="muted">Sermons and Bible study notes — what was taught, where the gospel was, and what to do with it.</p>
      ${items.length === 0 ? `<div class="empty">No recaps yet. After Sunday or your study group, take five minutes to write one.</div>` : ""}
      ${items.map((r) => `
        <div class="card recap">
          <div class="row between">
            <div>
              <div class="tiny">${esc(fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" }))} · ${esc(C.recapTypes.find((t) => t.id === r.type)?.label || r.type)}${r.speaker ? " · " + esc(r.speaker) : ""}</div>
              <div class="recap-title">${esc(r.title || r.passage || "Untitled")}${r.title && r.passage ? ` <span class="muted small">· ${esc(r.passage)}</span>` : ""}</div>
            </div>
            <div class="row" style="gap:4px">
              <a href="#recap/${r.id}" class="btn btn-sm">edit</a>
              <button class="btn-sm btn-danger" data-act="delRecap" data-id="${r.id}">delete</button>
            </div>
          </div>
          <details><summary>Show notes</summary>
            <dl class="recap-body">
              ${C.recapQuestions.filter((q) => r.answers?.[q.key]).map((q) => `<dt>${esc(q.label)}</dt><dd>${esc(r.answers[q.key])}</dd>`).join("")}
            </dl>
          </details>
        </div>`).join("")}
    </div>`;
  }

  function recapForm(r) {
    const isNew = !r;
    r = r || { id: uid(), type: new Date().getDay() === 0 ? "sermon" : "study", date: today(), title: "", passage: "", speaker: "", answers: {} };
    return `
    <div class="stack">
      <div class="row between"><h1>${isNew ? "New recap" : "Edit recap"}</h1><a href="#recap" class="btn btn-ghost btn-sm">← all recaps</a></div>
      <div class="card" id="recap-form" data-id="${r.id}" data-created="${esc(r.created || "")}">
        <div class="grid-2">
          <label class="field"><span>Type</span>
            <select id="r-type">${C.recapTypes.map((t) => `<option value="${t.id}" ${t.id === r.type ? "selected" : ""}>${t.label}</option>`).join("")}</select>
          </label>
          <label class="field"><span>Date</span><input type="date" id="r-date" value="${esc(r.date)}"></label>
        </div>
        <label class="field"><span>Title / topic</span><input type="text" id="r-title" value="${esc(r.title)}" placeholder="e.g. The prodigal son"></label>
        <div class="grid-2">
          <label class="field"><span>Passage</span><input type="text" id="r-passage" value="${esc(r.passage)}" placeholder="Luke 15:11–32"></label>
          <label class="field"><span>Speaker / leader</span><input type="text" id="r-speaker" value="${esc(r.speaker)}" placeholder="optional"></label>
        </div>
        ${C.recapQuestions.map((q) => `
          <label class="field">
            <span>${esc(q.label)}</span><span class="hint">${esc(q.hint)}</span>
            <textarea data-q="${q.key}">${esc(r.answers?.[q.key] || "")}</textarea>
          </label>`).join("")}
        <div class="row">
          <button class="btn-primary" data-act="saveRecap">Save recap</button>
          <span class="tiny">If you filled in “something to pray about”, it becomes a prayer point too.</span>
        </div>
      </div>
    </div>`;
  }

  ACT.saveRecap = () => {
    const f = $("#recap-form");
    const r = {
      id: f.dataset.id, created: f.dataset.created || nowIso(),
      type: $("#r-type").value, date: $("#r-date").value || today(),
      title: $("#r-title").value.trim(), passage: $("#r-passage").value.trim(), speaker: $("#r-speaker").value.trim(),
      answers: {},
    };
    $$("[data-q]").forEach((t) => (r.answers[t.dataset.q] = t.value.trim()));
    if (!r.title && !r.passage && !Object.values(r.answers).some(Boolean)) return toast("Nothing to save yet");
    const existing = S.data.recaps[r.id];
    put("recaps", r);
    if (r.answers.pray && r.answers.pray !== existing?.answers?.pray) addPrayer("S", r.answers.pray, { from: r.title || r.passage || "recap" });
    if (r.date === today()) { const d = day(); d.recap = true; saveDay(d); }
    toast("Recap saved"); location.hash = "#recap";
  };
  ACT.delRecap = (el) => { if (confirm("Delete this recap?")) remove("recaps", el.dataset.id); };

  // ------------------------------------------------------------ JOURNAL
  routes.journal = () => {
    const days = list("days").sort((a, b) => b.id.localeCompare(a.id)).slice(0, 60);
    const recapsByDate = {};
    list("recaps").forEach((r) => (recapsByDate[r.date] = recapsByDate[r.date] || []).push(r));
    if (!days.length) return `<div class="stack"><h1>Journal</h1><div class="empty">Your days will appear here as you read, pray and recap.</div></div>`;
    return `
    <div class="stack">
      <h1>Journal</h1>
      <p class="muted">A record of how God has been meeting you, day by day.</p>
      <div>
      ${days.map((d) => {
        const acts = ["A", "C", "T", "S"].filter((k) => d.acts?.[k]);
        const prayed = (d.prayed || []).map((id) => S.data.prayers[id]).filter(Boolean);
        const lensBits = Object.entries(d.lens || {}).filter(([, v]) => v);
        const rLens = Object.entries(d.readingLens || {}).filter(([, v]) => v);
        return `
        <div class="day">
          <div class="day-date">${esc(fmtDate(d.id, { weekday: "long", day: "numeric", month: "long" }))}</div>
          <ul>
            ${(d.readingsDone || []).length ? `<li>Bible: ${d.readingsDone.map((r) => { const m = r.match(/^([1-3]? ?[A-Za-z ]+?) (\d+)/); const b = m ? (m[1] === "Psalm" ? "Psalms" : m[1]) : null; return b && bookChapters(b) ? `<a href="#read/${encodeURIComponent(b)}/${m[2]}">${esc(r)}</a>` : esc(r); }).join(", ")}</li>` : ""}
            ${rLens.map(([k, v]) => `<li><span class="tiny">${esc(C.lens.find((q) => q.key === k)?.label || k)}</span><br>${esc(v)}</li>`).join("")}
            ${d.quietMin ? `<li>${d.quietMin} quiet minute${d.quietMin === 1 ? "" : "s"} in prayer</li>` : ""}
            ${d.devotional ? `<li>Read: <a href="${esc(d.devotional.link)}" target="_blank" rel="noopener">${esc(d.devotional.title)}</a> <span class="tiny">(${esc(d.devotional.sourceName)})</span></li>` : ""}
            ${lensBits.map(([k, v]) => `<li><span class="tiny">${esc(C.lens.find((q) => q.key === k)?.label || k)}</span><br>${esc(v)}</li>`).join("")}
            ${acts.length ? `<li>Prayed: ${acts.map((k) => `<span class="pill pill-${k}">${k}</span>`).join(" ")}</li>` : ""}
            ${prayed.length ? `<li>Prayed for ${prayed.length} point${prayed.length === 1 ? "" : "s"}: ${prayed.slice(0, 4).map((p) => esc(p.text)).join("; ")}${prayed.length > 4 ? "…" : ""}</li>` : ""}
            ${(recapsByDate[d.id] || []).map((r) => `<li>Recap: <a href="#recap/${r.id}">${esc(r.title || r.passage || "untitled")}</a></li>`).join("")}
          </ul>
        </div>`;
      }).join("")}
      </div>
    </div>`;
  };

  // ------------------------------------------------------------ SETTINGS
  routes.settings = () => {
    const hasFb = !!window.FIREBASE_CONFIG;
    const hidden = new Set(S.data.settings.hiddenSources || []);
    return `
    <div class="stack">
      <h1>Settings</h1>
      <div class="card">
        <div class="eyebrow">Sync</div>
        ${!hasFb ? `<p>Running in <b>this-device-only</b> mode. To sync between phone and laptop, paste your Firebase config into <code>firebase-config.js</code> (see README).</p>`
          : S.user ? `<p>Signed in as <b>${esc(S.user.email || S.user.displayName)}</b>. Prayer points, recaps and journal sync to Firestore and work offline.</p><button data-act="signOut">Sign out</button>`
          : `<p>Sign in with Google to sync across devices. Data already on this device will be uploaded on first sign-in.</p><button class="btn-primary" data-act="signIn">Sign in with Google</button>`}
      </div>
      <div class="card">
        <div class="eyebrow">Prayer groups &amp; weekly rotation</div>
        <p class="small muted">Each group gets a focus day in Supplication. Sunday is left free on purpose — pray for whoever is on your heart.</p>
        ${groups().map((g, i) => `
          <div class="group-row">
            <input type="text" value="${esc(g.name)}" data-change="groupName" data-i="${i}">
            <div class="daypick">${["S", "M", "T", "W", "T", "F", "S"].map((l, wd) => `<button class="${(g.days || []).includes(wd) ? "on" : ""}" data-act="groupDay" data-i="${i}" data-wd="${wd}" title="${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd]}">${l}</button>`).join("")}</div>
            <button class="btn-sm btn-danger" data-act="groupDel" data-i="${i}" title="Remove group">✕</button>
          </div>`).join("")}
        <div class="row" style="margin-top:8px"><input type="text" id="new-group" placeholder="New group (e.g. missionaries, neighbours…)" style="flex:1"><button class="btn-sm" data-act="groupAdd">Add</button></div>
      </div>
      <div class="card">
        <div class="eyebrow">Reading &amp; timer</div>
        <div class="row between" style="margin-bottom:8px"><span class="small">Bible translation</span><select data-change="setTranslation" style="width:auto">${C.translations.map(([k, n]) => `<option value="${k}" ${k === translation() ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="row between"><span class="small">Quiet prayer length</span><div class="seg">${[3, 5, 10, 15].map((m) => `<button class="${(settings().timerMin || 5) === m ? "on" : ""}" data-act="setMins" data-v="${m}">${m}</button>`).join("")}</div></div>
        ${settings().plan ? `<div class="tiny" style="margin-top:8px">Current plan: ${esc(settings().plan.name)} · <a href="#bible">manage</a></div>` : ""}
      </div>
      <div class="card">
        <div class="eyebrow">Bible text in the app</div>
        <p class="small muted">Chapters show inline from the World English Bible (public domain, stored in your repo). To read the <b>ESV</b> instead, paste a free key from <a href="https://api.esv.org" target="_blank" rel="noopener">api.esv.org</a> — it’s kept in your synced settings, not in the repo, and the app falls back to WEB when offline.</p>
        <label class="field"><span>ESV API key (optional)</span><input type="text" id="esv-key" value="${esc(settings().esvKey || "")}" placeholder="paste key, then Save" autocomplete="off"></label>
        <div class="row">
          <button class="btn-sm" data-act="saveEsvKey">Save key</button>
          ${settings().esvKey ? `<button class="btn-sm btn-danger" data-act="clearEsvKey">Remove key</button>` : ""}
          <button class="btn-sm" data-act="downloadBible">Download whole Bible for offline (~5 MB)</button>
        </div>
      </div>
      <div class="card">
        <div class="eyebrow">Devotional sources</div>
        ${(S.feed?.sources || []).map((s) => `
          <label class="row" style="padding:6px 0"><input type="checkbox" data-change="toggleSource" data-id="${s.id}" ${hidden.has(s.id) ? "" : "checked"}> ${esc(s.name)} <span class="tiny">${esc(s.speaker)}</span></label>`).join("") || `<p class="muted">Feed not loaded yet.</p>`}
        <p class="tiny" style="margin-top:8px">To add or remove feeds entirely, edit <code>SOURCES</code> in <code>scripts/fetch_feeds.py</code>.</p>
      </div>
      <div class="card">
        <div class="eyebrow">Backup</div>
        <div class="row">
          <button data-act="exportJson">Export JSON</button>
          <label class="btn">Import JSON <input type="file" accept="application/json" hidden data-change="importJson"></label>
        </div>
        <p class="tiny" style="margin-top:8px">${list("prayers").length} prayer points · ${list("recaps").length} recaps · ${list("days").length} days</p>
      </div>
      <div class="card flat">
        <div class="eyebrow">About</div>
        <div class="small">Abide v${APP_VERSION} · <a href="#" data-act="forceUpdate">check for update</a></div>
        <div class="tiny" style="margin-top:4px">If a feature you expect is missing, tap “check for update”, then close and reopen the app.</div>
      </div>
      <div class="card flat">
        <div class="eyebrow">Danger zone</div>
        <button class="btn-danger" data-act="wipe">Erase everything on this device</button>
      </div>
    </div>`;
  };
  ACT.signIn = signIn;
  ACT.signOut = signOut;
  ACT.saveEsvKey = () => { const k = ($("#esv-key")?.value || "").trim(); settings().esvKey = k || null; Object.keys(readerCache).forEach((x) => delete readerCache[x]); saveSettings(); toast(k ? "ESV key saved" : "Key cleared"); };
  ACT.clearEsvKey = () => { settings().esvKey = null; Object.keys(readerCache).forEach((x) => delete readerCache[x]); saveSettings(); toast("Key removed — showing WEB"); };
  function ensureGroups() { if (!settings().groups) settings().groups = JSON.parse(JSON.stringify(C.defaultGroups)); return settings().groups; }
  ACT.groupName = (el) => { const g = ensureGroups()[+el.dataset.i]; if (g && el.value.trim()) { g.name = el.value.trim(); saveSettings(); } };
  ACT.groupDay = (el) => {
    const g = ensureGroups()[+el.dataset.i]; const wd = +el.dataset.wd;
    g.days = g.days || []; g.days = g.days.includes(wd) ? g.days.filter((x) => x !== wd) : [...g.days, wd].sort();
    saveSettings();
  };
  ACT.groupDel = (el) => { const gs = ensureGroups(); const g = gs[+el.dataset.i]; if (confirm(`Remove group “${g.name}”? Its prayer points are kept (ungrouped).`)) { gs.splice(+el.dataset.i, 1); saveSettings(); } };
  ACT.groupAdd = () => {
    const inp = $("#new-group"); const name = (inp?.value || "").trim(); if (!name) return toast("Type a group name");
    ensureGroups().push({ id: "g-" + uid(), name, days: [] }); saveSettings(); render(); toast("Group added — tap the days it should come up");
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "new-group") { e.preventDefault(); ACT.groupAdd(); } });
  ACT.toggleSource = (el) => {
    const set = new Set(S.data.settings.hiddenSources || []);
    el.checked ? set.delete(el.dataset.id) : set.add(el.dataset.id);
    S.data.settings.hiddenSources = [...set]; saveSettings();
  };
  ACT.exportJson = () => {
    const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `abide-backup-${today()}.json`; a.click();
  };
  ACT.importJson = async (el) => {
    const f = el.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      let n = 0;
      ["prayers", "recaps", "days", "verses"].forEach((c) => Object.values(d[c] || {}).forEach((it) => { if (it && it.id) { put(c, it); n++; } }));
      toast(`Imported ${n} items`);
    } catch (e) { toast("Import failed: " + e.message); }
  };
  ACT.wipe = () => {
    if (!confirm("Erase all local data on this device? (Cloud data is untouched.)")) return;
    localStorage.removeItem(LS_KEY); S.data = { prayers: {}, recaps: {}, days: {}, verses: {}, settings: { hiddenSources: [] } }; render(); toast("Erased");
  };

  // ------------------------------------------------------------ boot
  bind($("#view"));
  loadLocal();
  initFirebase();
  render();
  loadFeed();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      S.swReg = reg;
      reg.addEventListener("updatefound", () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) showUpdateBar();
        });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  function showUpdateBar() {
    const el = $("#toast"); el.innerHTML = `New version ready — <a href="#" id="do-update" style="color:#f3e7c9;text-decoration:underline">tap to update</a>`; el.hidden = false; clearTimeout(toastTimer);
    $("#do-update").onclick = (e) => { e.preventDefault(); S.swReg?.waiting?.postMessage("skipWaiting"); setTimeout(() => location.reload(), 800); };
  }
  ACT.forceUpdate = async () => {
    toast("Checking…");
    try {
      const reg = S.swReg || (await navigator.serviceWorker?.getRegistration());
      if (reg) { await reg.update(); if (reg.waiting) { reg.waiting.postMessage("skipWaiting"); setTimeout(() => location.reload(), 800); return; } }
      // Hard refresh regardless: clear caches and reload from network.
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      location.reload();
    } catch (e) { location.reload(); }
  };
})();
