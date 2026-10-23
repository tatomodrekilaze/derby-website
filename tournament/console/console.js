/* DERBY console: run the whole tournament; every save goes live on the TV */
(function () {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const COLORS = ["#f4c22b", "#1f4fbf", "#d8262e", "#5b2a91", "#f2741c", "#11804a", "#7c1e26", "#141519"];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const TOKEN_KEY = "derby-t-token", BACKUP_KEY = "derby-t-backup", AUTO_KEY = "derby-t-autosave", HIST_KEY = "derby-t-history";
  const PRESETS = ["ფინალი მალე დაიწყება", "შემდეგი მატჩი 5 წუთში", "გთხოვთ, დაიკავოთ ადგილები", "ბარი ღიაა, მიირთვით"];

  let token = store.get(TOKEN_KEY);
  let server = { version: -1, updatedAt: null, data: null }; // last copy the server confirmed
  let draft = null;                                          // what you are editing
  let dirty = false, saving = false, conflict = null, viewers = 0, online = false;
  let filter = "all", breakOpen = false;

  /* ---------- small helpers ---------- */
  let msgT;
  function msg(text, ok) {
    const el = $("#message");
    el.textContent = text; el.className = ok ? "ok" : "";
    clearTimeout(msgT); msgT = setTimeout(() => { el.textContent = ""; }, ok ? 2600 : 6000);
  }
  const tbilisi = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const hhmm = iso => iso ? tbilisi.format(new Date(iso)).slice(0, 5) : "";
  function ballFor(id) {
    const i = draft.players.findIndex(p => p.id === id);
    if (i < 0) return "";
    return `<span class="b" style="--c:${COLORS[i % 8]}">${i + 1}</span>`;
  }
  const pname = id => { const p = draft.players.find(x => x.id === id); return p ? p.name : ""; };
  const isOut = id => { const p = draft.players.find(x => x.id === id); return !!(p && p.out); };
  const settle = () => draft.bracket && DT.settle(draft.bracket, DT.outSet(draft));
  const findMatch = id => draft.bracket.rounds.flat().find(m => m.id === id);
  function log(text) {
    if (!Array.isArray(draft.log)) draft.log = [];
    draft.log.unshift({ t: new Date().toISOString(), m: text });
    draft.log = draft.log.slice(0, 120);
  }
  function normalize(d) {
    const x = Object.assign(DT.emptyData(), clone(d || {}));
    if (!Array.isArray(x.players)) x.players = [];
    if (!Array.isArray(x.log)) x.log = [];
    if (!DT.STATUS[x.status]) x.status = "registration";
    return x;
  }

  /* ---------- api ---------- */
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(DT.API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, cache: "no-store" });
    let body = null; try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  }
  async function health() {
    try { const r = await api("/api/health"); online = r.status === 200; viewers = (r.body && r.body.viewers) || 0; }
    catch (e) { online = false; }
    paintNet();
  }
  function paintNet() {
    const n = $("#net");
    n.classList.toggle("on", online);
    n.querySelector("span").textContent = online ? `live · ${viewers} screen${viewers === 1 ? "" : "s"}` : "offline";
    const f = $("#loginFoot");
    if (f) f.textContent = online ? `derby-live :: online · v${Math.max(0, server.version)}` : "derby-live :: waking up (up to 1 min)";
  }
  setInterval(health, 15000);

  /* ---------- auth ---------- */
  function showLogin() {
    $("#loginPanel").hidden = false; $("#app").hidden = true; $("#statusbar").hidden = true;
    $("#logout").hidden = true; $("#menuBtn").hidden = true;
    setTimeout(() => $("#password").focus(), 50);
  }
  function showApp() {
    $("#loginPanel").hidden = true; $("#app").hidden = false; $("#statusbar").hidden = false;
    $("#logout").hidden = false; $("#menuBtn").hidden = false;
  }
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("#signIn"); btn.disabled = true; btn.textContent = "...";
    try {
      const r = await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
      if (r.status === 200 && r.body.token) { token = r.body.token; store.set(TOKEN_KEY, token); $("#password").value = ""; await enter(); }
      else if (r.status === 429) msg("ძალიან ბევრი მცდელობა. სცადე ერთ წუთში.");
      else msg("არასწორი პაროლი");
    } catch (err) { msg("სერვერთან კავშირი ვერ მოხერხდა. სცადე თავიდან, შეიძლება იღვიძებს."); }
    btn.disabled = false; btn.textContent = "შესვლა";
  });
  $("#logout").addEventListener("click", () => {
    if (dirty && !confirm("შეუნახავი ცვლილებები დაიკარგება. გავიდე?")) return;
    token = null; store.del(TOKEN_KEY); dirty = false; showLogin();
  });
  function kicked() { token = null; store.del(TOKEN_KEY); showLogin(); msg("სესია ამოიწურა. შედი თავიდან."); }

  async function enter() {
    showApp();
    try { const r = await api("/api/state"); adopt(r.body, true); }
    catch (e) { msg("სერვერი ჯერ არ პასუხობს. ვცდილობ თავიდან."); setTimeout(enter, 4000); }
  }

  /* ---------- state in / out ---------- */
  function adopt(st, first) {
    if (!st || typeof st.version !== "number") return;
    if (st.version === server.version && !first) return;
    if (saving && !first) return; // our own save echoing back
    if (dirty && !first && JSON.stringify(st.data) === JSON.stringify(draft)) { server = clone(st); dirty = false; render(); return; }
    // the free server forgets everything after a restart; put the last saved copy back
    if (st.version === 0 && !st.data && token) {
      let backup = null; try { backup = JSON.parse(store.get(BACKUP_KEY) || "null"); } catch (e) {}
      if (backup && backup.data) {
        server = st; draft = normalize(backup.data); dirty = true;
        render(); save(true, "სერვერი გადაიტვირთა: ბოლო შენახული ვერსია აღდგა");
        return;
      }
    }
    if (dirty && !first) { conflict = st; render(); return; }
    server = clone(st);
    draft = normalize(st.data);
    dirty = false; conflict = null;
    render();
  }

  let autoT;
  function changed(rerender) {
    dirty = true;
    if (rerender) render(); else paintStatus();
    if ($("#autosave").checked) { clearTimeout(autoT); autoT = setTimeout(() => save(), 700); }
  }

  async function save(force, okText) {
    if (!draft || saving || !token) return;
    if (!dirty && !force) return;
    saving = true; paintStatus();
    try {
      const r = await api("/api/state", { method: "POST", body: JSON.stringify({ data: draft, baseVersion: server.version, force: !!force }) });
      if (r.status === 200) {
        server = { version: r.body.version, updatedAt: r.body.updatedAt, data: clone(draft) };
        store.set(BACKUP_KEY, JSON.stringify(server));
        remember(server);
        dirty = false; conflict = null;
        msg(okText || `შენახულია · v${r.body.version} · TV განახლდა`, true);
      } else if (r.status === 401) kicked();
      else if (r.status === 409) { conflict = r.body.state; msg("სხვა ეკრანიდან უკვე შეინახა. აირჩიე რომელი ვერსია დარჩეს."); }
      else msg("შენახვა ვერ მოხერხდა: " + ((r.body && r.body.error) || r.status));
    } catch (e) { msg("შენახვა ვერ მოხერხდა: სერვერთან კავშირი არ არის"); }
    saving = false;
    render();
  }
  // big actions (start, break, call...) go out immediately
  function now(text, fn, okText) { fn(); log(text); dirty = true; render(); save(false, okText); }

  function remember(s) {
    let h = []; try { h = JSON.parse(store.get(HIST_KEY) || "[]"); } catch (e) {}
    h.unshift({ v: s.version, at: s.updatedAt, data: s.data });
    store.set(HIST_KEY, JSON.stringify(h.slice(0, 15)));
  }

  $("#saveBtn").addEventListener("click", () => save());
  addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
  $("#autosave").checked = store.get(AUTO_KEY) !== "0"; // on unless switched off
  $("#autosave").addEventListener("change", e => { store.set(AUTO_KEY, e.target.checked ? "1" : "0"); if (e.target.checked && dirty) save(); });
  addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function paintStatus() {
    const s = $("#sbState");
    s.className = "sb-state" + (saving ? " saving" : dirty ? " dirty" : "");
    s.textContent = saving ? "saving..." : dirty ? "unsaved changes" : "synced";
    $("#saveBtn").disabled = !dirty || saving;
    const chip = $("#sbChip");
    if (draft) { chip.className = "chip chip--" + draft.status; chip.textContent = DT.STATUS[draft.status].en; }
    const t = server.updatedAt ? tbilisi.format(new Date(server.updatedAt)) : "never";
    $("#sbMeta").textContent = `v${Math.max(0, server.version)} · last save ${t} · ${viewers} screen${viewers === 1 ? "" : "s"} online`;
  }

  /* ---------- live stream ---------- */
  let es;
  function stream() {
    try { es && es.close(); } catch (e) {}
    es = new EventSource(DT.API + "/api/stream");
    es.addEventListener("state", e => { online = true; paintNet(); if (token && !$("#app").hidden) { try { adopt(JSON.parse(e.data)); } catch (err) {} } });
    es.onerror = () => { online = false; paintNet(); };
  }

  /* ---------- router ---------- */
  const views = { play, overview, players, draw, matches, announce, display, settings, history, danger };
  function current() { const v = location.hash.replace(/^#\//, ""); return views[v] ? v : "play"; }
  addEventListener("hashchange", () => { document.body.classList.remove("side-open"); render(); });
  $("#menuBtn").addEventListener("click", () => document.body.classList.toggle("side-open"));

  function render() {
    if (!draft) return;
    const v = current();
    $$("#side a").forEach(a => a.classList.toggle("on", a.dataset.view === v));
    const y = scrollY, focus = document.activeElement && document.activeElement.id;
    $("#view").innerHTML = conflictNotice() + views[v]();
    bind(v);
    scrollTo(0, y);
    if (focus && $("#" + focus)) $("#" + focus).focus();
    paintStatus();
  }
  function conflictNotice() {
    if (!conflict) return "";
    return `<div class="notice warn">სერვერზე ახალი ვერსიაა (v${conflict.version}), შენ კი შეუნახავი ცვლილებები გაქვს.
      <button data-act="take-server">სერვერის ვერსიის ჩატვირთვა</button><button data-act="force-save">ჩემი ვერსიის შენახვა</button></div>`;
  }

  /* ---------- play: the simple screen. set up in one step, then tap who won ---------- */
  function loc(n) { return n.endsWith("ი") ? n.slice(0, -1) + "ში" : n + "-ში"; }
  function nextText(br, r, i) {
    const nx = DT.nextInfo(br, r, i);
    if (nx.final) return "ეს ფინალია: გამარჯვებული ჩემპიონი ხდება";
    const o = nx.opp;
    const who = o.id ? `<b>${esc(pname(o.id))}</b>` : o.pair ? `<b>${esc(pname(o.pair[0]))}</b> ან <b>${esc(pname(o.pair[1]))}</b>` : "მეტოქე ჯერ უცნობია";
    return `გამარჯვებული გადის ${esc(loc(nx.round))} და ხვდება: ${who}`;
  }
  function playList() {
    const br = draft.bracket, all = [];
    br.rounds.forEach((row, r) => row.forEach((m, i) => { if (!DT.isBye(m)) all.push({ m, r, i }); }));
    return all;
  }
  function card(x) {
    const { m, r, i } = x, live = m.live && !m.winner;
    const p = id => `<button class="pc__p" data-pwin="${m.id}" data-pid="${id}">${ballFor(id)}<span>${esc(pname(id))}</span></button>`;
    return `<div class="pc${live ? " is-live" : ""}">
      <div class="pc__top"><b>${esc(DT.roundName(draft.bracket.rounds[r].length, r))}</b>${live ? `<span class="pc__live">● LIVE</span>` : ""}
        <input class="pc__tbl" data-table="${m.id}" value="${esc(m.table || "")}" placeholder="მაგიდა №" maxlength="4"></div>
      <div class="pc__q">ვინ მოიგო? დააჭირე სახელს</div>
      <div class="pc__pl">${p(m.a)}<span class="pc__vs">vs</span>${p(m.b)}</div>
      <div class="pc__foot">
        <input class="pc__sc" data-score="${m.id}" value="${esc(m.score || "")}" placeholder="ანგარიში, არასავალდებულო: 3-1" maxlength="9">
        ${live ? `<button data-pstop="${m.id}">LIVE გამორთვა</button>` : `<button class="good" data-pstart="${m.id}">[ ▶ მაგიდაზე გამოძახება ]</button>`}
      </div>
      <div class="pc__next">${nextText(draft.bracket, r, i)}</div>
    </div>`;
  }
  function play() {
    const br = draft.bracket, s = draft.status;
    if (!br) {
      const n = draft.players.filter(p => !p.out).length;
      return `<h2 class="vh">თამაში</h2><p class="lede">ახალი ტურნირი ერთ ნაბიჯში.</p>
      <section class="box wiz"><div class="box-head">SETUP :: ახალი ტურნირი</div><div class="box-body">
        <label for="wizN">1. რამდენი მოთამაშეა?</label>
        <input id="wizN" class="wiz__n" type="number" min="2" max="128" value="${n >= 2 ? n : 16}" inputmode="numeric">
        <label for="wizNames">2. სახელები (არასავალდებულო). თითო სახელი ცალკე ხაზზე. თუ ცარიელია, იქნება "მოთამაშე 1, 2, 3..." და მერე შეცვლი</label>
        <textarea id="wizNames" placeholder="გიორგი&#10;ლევანი&#10;ნიკა">${esc(draft.players.filter(p => !p.out).map(p => p.name).join("\n"))}</textarea>
        <label class="row" style="color:var(--ink);font-size:14px"><input type="checkbox" id="wizRandom" checked> შემთხვევითი წილისყრა</label>
        <button class="big good" data-act="wiz-go">[ ▶ ბადის შექმნა ]</button>
        <p class="lede">დანარჩენს სისტემა თავად აკეთებს: ქმნის წყვილებს, გამარჯვებულს ავტომატურად გადაიყვანს შემდეგ წრეში. თუ რაოდენობა 8, 16 ან 32 არ არის, ზოგიერთი მოთამაშე პირდაპირ მე-2 წრეში გადავა.</p>
      </div></section>`;
    }
    const all = playList(), champ = DT.champion(draft);
    const live = all.filter(x => x.m.live && !x.m.winner && DT.ready(x.m));
    const ready = all.filter(x => DT.ready(x.m) && !x.m.winner && !x.m.live);
    const waiting = all.filter(x => !x.m.winner && !DT.ready(x.m) && (x.m.a || x.m.b));
    const done = all.filter(x => x.m.winner).sort((a, b) => (b.m.doneAt || "").localeCompare(a.m.doneAt || ""));
    const st = DT.stats(draft);
    let top = "";
    if (s === "registration") top = `<button class="big good" data-act="start">[ ▶ ტურნირის დაწყება ]</button><a href="#/players"><button class="big">სახელების შეცვლა</button></a><button class="big danger-btn" data-act="wiz-reset">[ ახლიდან ]</button>`;
    else if (s === "live") top = `<button class="big warnb" data-act="break-quick">[ ❚❚ შესვენება ]</button><button class="big" data-act="finish">[ ■ დასრულება ]</button>`;
    else if (s === "break") top = `<button class="big good" data-act="resume">[ ▶ შესვენების დასრულება ]</button>`;
    else top = `<button class="big" data-act="reopen">[ ↺ თავიდან გახსნა ]</button><button class="big danger-btn" data-act="new-tournament">[ ახალი ტურნირი ]</button>`;
    return `<h2 class="vh">თამაში</h2>
      <p class="lede"><span class="chip chip--${s}">${DT.STATUS[s].ka}</span> · მატჩი ${st.done}/${st.total} · ${st.active} მოთამაშე</p>
      <div class="row play-top">${top}</div>
      ${s === "break" ? `<div class="notice warn">შესვენება მიმდინარეობს. TV-ზე ჩანს "მალე გავაგრძელებთ".</div>` : ""}
      ${champ ? `<div class="champ-box"><small>ჩემპიონი</small><b>${esc(pname(champ))}</b></div>` : ""}
      ${live.length ? `<h3 class="sub">ახლა თამაშობენ · ${live.length}</h3><div class="pcs">${live.map(card).join("")}</div>` : ""}
      ${ready.length ? `<h3 class="sub">შემდეგი მატჩები · ${ready.length}</h3><div class="pcs">${ready.map(card).join("")}</div>` : ""}
      ${!live.length && !ready.length && !champ ? `<div class="notice">ახლა სათამაშო მატჩი არ არის.</div>` : ""}
      ${waiting.length ? `<h3 class="sub">ელოდებიან მეტოქეს · ${waiting.length}</h3><div class="table-wrap"><table><tbody>
        ${waiting.map(x => { const k = x.m.a || x.m.b; return `<tr><td>${ballFor(k)} ${esc(pname(k))}</td><td class="dim">${esc(DT.roundName(draft.bracket.rounds[x.r].length, x.r))} · მეტოქე ჯერ თამაშობს</td></tr>`; }).join("")}
      </tbody></table></div>` : ""}
      ${done.length ? `<h3 class="sub">დასრულდა · ${done.length}</h3><div class="table-wrap"><table><tbody>
        ${done.map(x => {
          const lose = x.m.winner === x.m.a ? x.m.b : x.m.a, R = draft.bracket.rounds;
          const nxt = x.r < R.length - 1 ? R[x.r + 1][Math.floor(x.i / 2)] : null;
          const canUndo = !nxt || !nxt.winner;
          return `<tr><td><b>${esc(pname(x.m.winner))}</b> მოიგო ${esc(pname(lose))}${x.m.score ? ` · ${esc(x.m.score)}` : ""}</td>
            <td class="dim">${esc(DT.roundName(R[x.r].length, x.r))}</td>
            <td class="actions"><button data-pundo="${x.m.id}" ${canUndo ? "" : `disabled title="შემდეგი მატჩი უკვე ითამაშეს"`}>გაუქმება</button></td></tr>`;
        }).join("")}
      </tbody></table></div>` : ""}`;
  }

  /* ---------- overview: tournament state controls ---------- */
  function overview() {
    const st = DT.stats(draft), br = draft.bracket, champ = DT.champion(draft);
    const roundName = br && st.round !== null ? DT.roundName(br.rounds[st.round].length, st.round) : "n/a";
    const lives = br ? br.rounds.flat().filter(m => m.live && !m.winner) : [];
    const steps = ["registration", "live", "break", "finished"].map(k => `<span class="step${draft.status === k ? " on" : ""}">${DT.STATUS[k].en}</span>`).join(`<span class="arrow">→</span>`);
    let controls = "";
    const s = draft.status;
    if (s === "registration") {
      controls = `<button class="big good" data-act="start" ${br ? "" : "disabled"}>[ ▶ ტურნირის დაწყება ]</button>
        ${br ? "" : `<p class="lede">დასაწყებად ჯერ შექმენი ბადე → <a href="#/draw">draw</a></p>`}`;
    } else if (s === "live") {
      controls = `<button class="big warnb" data-act="break-open">[ ❚❚ შესვენება ]</button>
        <button class="big" data-act="finish">[ ■ დასრულება ]</button>
        ${breakOpen ? breakForm() : ""}`;
    } else if (s === "break") {
      const b = draft.breakInfo || {};
      const left = b.until ? Math.max(0, Math.round((new Date(b.until) - Date.now()) / 60000)) : null;
      controls = `<div class="notice warn">შესვენება${b.since ? ` დაიწყო ${hhmm(b.since)}-ზე` : ""}${b.until ? ` · გაგრძელდება ${hhmm(b.until)}-ზე (${left} წთ)` : " · დროის გარეშე"}${b.message ? ` · „${esc(b.message)}“` : ""}</div>
        <button class="big good" data-act="resume">[ ▶ გაგრძელება ]</button>
        ${b.until ? `<button class="big" data-act="extend">[ +5 წთ ]</button>` : ""}
        <button class="big" data-act="finish">[ ■ დასრულება ]</button>`;
    } else {
      controls = `${champ ? `<div class="notice ok">ჩემპიონი: ${esc(pname(champ))}</div>` : ""}
        <button class="big" data-act="reopen">[ ↺ თავიდან გახსნა ]</button>`;
    }
    let next = "";
    if (!draft.players.length) next = `<div class="notice">step 1 :: დაამატე მოთამაშეები <a href="#/players">players →</a></div>`;
    else if (!br) next = `<div class="notice">step 2 :: შექმენი ბადე <a href="#/draw">draw →</a></div>`;
    else if (s === "registration") next = `<div class="notice">step 3 :: დააჭირე ტურნირის დაწყებას</div>`;
    else if (s === "live") next = `<div class="notice">step 4 :: ჩაწერე შედეგები <a href="#/matches">matches →</a></div>`;
    return `<h2 class="vh">overview</h2><p class="lede">${esc(draft.title)} · ${esc(draft.subtitle || "")}</p>
      <section class="box ctl">
        <div class="box-head">STATE :: <span class="chip chip--${s}">${DT.STATUS[s].en}</span> <span class="dim">${DT.STATUS[s].ka}</span></div>
        <div class="box-body"><div class="steps">${steps}</div><div class="row">${controls}</div></div>
      </section>
      ${next}
      <div class="stats">
        <div class="stat"><span>players</span><b>${st.active}${st.players !== st.active ? `<small>/${st.players}</small>` : ""}</b></div>
        <div class="stat ok"><span>matches_done</span><b>${st.done}/${st.total}</b></div>
        <div class="stat live"><span>live_now</span><b>${st.live}</b></div>
        <div class="stat"><span>current_round</span><b style="font-size:15px">${esc(roundName)}</b></div>
        <div class="stat ${online ? "ok" : "warn"}"><span>server</span><b>${online ? "online" : "offline"}</b></div>
        <div class="stat"><span>screens</span><b>${viewers}</b></div>
      </div>
      <h3 class="sub">live_matches</h3>
      ${lives.length ? `<div class="table-wrap"><table><tbody>${lives.map(m => `<tr><td>${ballFor(m.a)} ${esc(pname(m.a))}</td><td class="num">vs</td><td>${ballFor(m.b)} ${esc(pname(m.b))}</td><td class="num">${m.table ? "table " + esc(m.table) : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="dim">ახლა LIVE მატჩი არ არის.</p>`}
      <h3 class="sub">tv_link</h3>
      <p><code class="k">${esc(tvUrl())}</code></p>`;
  }
  function breakForm() {
    return `<div class="breakform">
      <label for="breakMsg">შეტყობინება TV-ზე (არასავალდებულო)</label>
      <input id="breakMsg" maxlength="80" placeholder="მაგ: ფინალამდე მოკლე შესვენება">
      <div class="row"><button class="primary" data-act="break-go" data-min="0">[ ❚❚ შესვენება, დროის გარეშე ]</button><button data-act="break-close">გაუქმება</button></div>
      <label>ან ტაიმერით (TV-ზე უკუთვლა)</label>
      <div class="row">${[5, 10, 15, 30].map(m => `<button data-act="break-go" data-min="${m}">${m} წთ</button>`).join("")}</div>
    </div>`;
  }

  /* ---------- players ---------- */
  function players() {
    const locked = !!draft.bracket;
    const active = draft.players.filter(p => !p.out).length;
    return `<h2 class="vh">players</h2><p class="lede">${active} active${draft.players.length !== active ? ` · ${draft.players.length - active} withdrawn` : ""}</p>
      ${locked ? `<div class="notice">ბადე შექმნილია. სახელი შეგიძლია შეცვალო; მოთამაშის მოხსნისას მისი მეტოქე ავტომატურად იგებს (W/O). ახლის დასამატებლად ბადე თავიდან შექმენი <a href="#/draw">draw</a>.</div>` : ""}
      <form class="toolbar" id="addForm">
        <input id="newName" placeholder="მოთამაშის სახელი" maxlength="40" autocomplete="off" ${locked ? "disabled" : ""}>
        <button class="primary" ${locked ? "disabled" : ""}>[ + დამატება ]</button>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th class="num">#</th><th>name</th><th class="num">state</th><th class="num"></th></tr></thead>
        <tbody>${draft.players.length ? draft.players.map((p, i) => `
          <tr class="${p.out ? "is-out" : ""}"><td class="num">${ballFor(p.id)}</td>
          <td><input class="cell" data-rename="${p.id}" value="${esc(p.name)}" maxlength="40"></td>
          <td class="num">${p.out ? `<span class="bad-t">withdrawn</span>` : `<span class="ok-t">active</span>`}</td>
          <td class="actions">
            ${locked ? (p.out ? `<button data-act="restore" data-id="${p.id}">დაბრუნება</button>` : `<button class="danger-btn" data-act="withdraw" data-id="${p.id}">მოხსნა</button>`)
              : `<button data-act="up" data-id="${p.id}" ${i === 0 ? "disabled" : ""}>↑</button>
                 <button data-act="down" data-id="${p.id}" ${i === draft.players.length - 1 ? "disabled" : ""}>↓</button>
                 <button class="danger-btn" data-act="del" data-id="${p.id}">წაშლა</button>`}
          </td></tr>`).join("") : `<tr><td class="empty" colspan="4">ჯერ მოთამაშე არ არის</td></tr>`}</tbody>
      </table></div>
      ${locked ? "" : `<h3 class="sub">bulk_import</h3>
      <p class="lede">ჩასვი სია Excel-იდან ან ჩატიდან: ერთი სახელი ერთ ხაზზე.</p>
      <textarea id="bulk" placeholder="გიორგი&#10;ლევანი&#10;ნიკა"></textarea>
      <div class="row" style="margin-top:8px">
        <button data-act="bulk-add">[ დამატება სიაში ]</button>
        <button data-act="bulk-replace">[ სიის ჩანაცვლება ]</button>
        ${draft.players.length ? `<button class="danger-btn" data-act="clear-players">[ ყველას წაშლა ]</button>` : ""}
      </div>`}`;
  }

  /* ---------- draw ---------- */
  function draw() {
    const act = draft.players.filter(p => !p.out), n = act.length;
    let size = 0; if (n >= 2) { size = 2; while (size < n) size *= 2; }
    const byes = size ? size - n : 0, br = draft.bracket;
    const results = br ? br.rounds.flat().filter(m => m.winner && !DT.isBye(m) && !m.wo).length : 0;
    const opts = sel => `<option value="">...</option>` + act.map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const slot = (m, side) => {
      const id = m[side];
      if (id === DT.BYE) return `<span class="dim">bye</span>`;
      return `<div class="row nowrap">${ballFor(id)}<select data-swap="${m.id}" data-side="${side}">${opts(id)}</select></div>`;
    };
    return `<h2 class="vh">draw</h2><p class="lede">ნოკაუტი: წაგებული ტოვებს ტურნირს, გამარჯვებული ავტომატურად გადადის შემდეგ ეტაპზე.</p>
      <div class="stats">
        <div class="stat"><span>players</span><b>${n}</b></div>
        <div class="stat"><span>bracket_size</span><b>${size || "n/a"}</b></div>
        <div class="stat"><span>byes</span><b>${byes}</b></div>
        <div class="stat"><span>first_round_matches</span><b>${size ? size / 2 - byes : 0}</b></div>
      </div>
      ${byes ? `<p class="lede">${byes} მოთამაშე პირდაპირ გადადის მეორე წრეში (bye). ისინი ბადეში თანაბრად ნაწილდება.</p>` : ""}
      ${br ? `<div class="notice warn">ბადე არსებობს${results ? `, ${results} შედეგით` : ""}. თავიდან შექმნა წაშლის ყველა შედეგს.</div>` : ""}
      <label class="row" style="color:var(--ink);font-size:14px;margin-bottom:12px"><input type="checkbox" id="randomDraw" checked> შემთხვევითი წილისყრა (გამორთვისას: სიის რიგით)</label>
      <div class="row">
        <button class="primary" data-act="generate" ${n < 2 ? "disabled" : ""}>[ ${br ? "ბადის თავიდან შექმნა" : "ბადის შექმნა"} ]</button>
        ${br ? `<button class="danger-btn" data-act="clear-bracket">[ ბადის წაშლა ]</button>` : ""}
      </div>
      ${br ? `<h3 class="sub">first_round · edit pairings</h3>
        <p class="lede">აირჩიე სხვა მოთამაშე ნებისმიერ ადგილას: ორი მოთამაშე ადგილს გაცვლის.</p>
        <div class="table-wrap"><table><tbody>${br.rounds[0].map((m, i) => `<tr><td class="num">M${i + 1}</td><td>${slot(m, "a")}</td><td class="num">vs</td><td>${slot(m, "b")}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  }

  /* ---------- matches ---------- */
  function matches() {
    const br = draft.bracket;
    if (!br) return `<h2 class="vh">matches</h2><div class="notice">ჯერ შექმენი ბადე <a href="#/draw">draw →</a></div>`;
    const sv = server.data && server.data.bracket;
    const svMatch = id => sv ? sv.rounds.flat().find(m => m.id === id) : null;
    const show = m => filter === "all" ? true : filter === "open" ? (DT.ready(m) && !m.winner) : filter === "live" ? (m.live && !m.winner) : !!m.winner;
    let html = `<h2 class="vh">matches</h2><p class="lede">დააჭირე გამარჯვებულს, მერე [ შენახვა ]. [ call ] მატჩს LIVE-ად აქცევს და TV-ზე ეძახის მოთამაშეებს.</p>
      ${draft.status === "registration" ? `<div class="notice">ტურნირი ჯერ არ დაწყებულა. <a href="#/overview">overview</a> → დაწყება</div>` : ""}
      <div class="toolbar">${["all", "open", "live", "done"].map(f => `<button data-filter="${f}" class="${filter === f ? "primary" : ""}">${f}</button>`).join("")}</div>`;
    br.rounds.forEach((row, r) => {
      const real = row.filter(m => !DT.isBye(m));
      const list = real.filter(show);
      const byes = row.length - real.length;
      if (!list.length) return;
      html += `<div class="round-h"><b>${esc(DT.roundName(row.length, r))}</b><span>${real.filter(m => m.winner).length}/${real.length} done${byes ? ` · ${byes} bye` : ""}</span></div>
        <div class="match head"><span>id</span><span>table</span><span>player_a</span><span>score</span><span>player_b</span><span>live</span><span>call</span><span class="status">status</span></div>`;
      list.forEach(m => {
        const i = row.indexOf(m), ready = DT.ready(m), s0 = svMatch(m.id);
        const isDirty = !s0 || s0.winner !== m.winner || (s0.score || "") !== (m.score || "") || (s0.table || "") !== (m.table || "") || !!s0.live !== !!m.live;
        const pick = id => {
          if (!id) return `<button class="pick tbd" disabled><span>ელოდება</span></button>`;
          const cls = m.winner ? (m.winner === id ? " win" : " lose") : "";
          return `<button class="pick${cls}${isOut(id) ? " out" : ""}" data-win="${m.id}" data-pid="${id}" ${ready ? "" : "disabled"}>${ballFor(id)}<span>${esc(pname(id))}</span></button>`;
        };
        const status = m.winner ? `<span class="status done">${m.wo ? "w/o" : "done"}</span>` : m.live ? `<span class="status live">● live</span>` : ready ? `<span class="status wait">ready</span>` : `<span class="status wait">waiting</span>`;
        html += `<div class="match${isDirty ? " is-dirty" : ""}" data-mid="${m.id}">
          <span class="mid">R${r + 1}·M${i + 1}</span>
          <input class="tbl" data-table="${m.id}" value="${esc(m.table || "")}" placeholder="table" maxlength="4">
          <div class="pa">${pick(m.a)}</div>
          <input class="sc" data-score="${m.id}" value="${esc(m.score || "")}" placeholder="0-0" maxlength="9" ${ready ? "" : "disabled"}>
          <div class="pb">${pick(m.b)}</div>
          <button class="lv live-btn${m.live && !m.winner ? " on" : ""}" data-live="${m.id}" ${ready && !m.winner ? "" : "disabled"}>LIVE</button>
          <button class="cl" data-call="${m.id}" ${ready && !m.winner ? "" : "disabled"}>call</button>
          ${status}
        </div>`;
      });
    });
    return html;
  }

  /* ---------- announcements ---------- */
  function announce() {
    const a = draft.announce || {}, live = DT.activeAnnounce(draft);
    return `<h2 class="vh">announce</h2><p class="lede">შეტყობინება ტელევიზორის ქვედა ნაწილში. ჩვენება და დამალვა მაშინვე ინახება.</p>
      <div class="notice ${live ? "ok" : ""}">ახლა TV-ზე: ${live ? `„${esc(live.text)}“${live.until ? ` · ქრება ${hhmm(live.until)}-ზე` : ""}` : "არაფერი"}</div>
      <div class="form-grid">
        <div><label for="annText">text</label><input id="annText" maxlength="120" value="${esc(a.kind === "note" ? a.text || "" : "")}" placeholder="მაგ: ფინალი 21:00-ზე"></div>
      </div>
      <div class="row">${PRESETS.map(p => `<button data-preset="${esc(p)}">${esc(p)}</button>`).join("")}</div>
      <div class="row" style="margin-top:14px">
        <button class="primary" data-act="ann-show">[ TV-ზე ჩვენება ]</button>
        <button data-act="ann-hide" ${live ? "" : "disabled"}>[ დამალვა ]</button>
      </div>`;
  }

  function tvUrl() { return new URL("../", location.href).href.replace(/\?.*$/, ""); }

  function display() {
    const d = draft.display || "auto";
    const opt = (v, t) => `<label><input type="radio" name="disp" value="${v}" ${d === v ? "checked" : ""}> ${t}</label>`;
    return `<h2 class="vh">display</h2><p class="lede">რა ჩანს ტელევიზორზე. ცვლილება ჩანს შენახვის შემდეგ.</p>
      <div class="radio-list">
        ${opt("auto", "auto :: რეგისტრაციისას მოთამაშეები, დაწყების შემდეგ ბადე")}
        ${opt("players", "players :: მხოლოდ მოთამაშეების სია")}
        ${opt("bracket", "bracket :: მხოლოდ ბადე და შედეგები")}
      </div>
      <h3 class="sub">tv_link</h3>
      <div class="row"><code class="k">${esc(tvUrl())}</code><button data-act="copy">[ copy ]</button><a href="${esc(tvUrl())}" target="_blank" rel="noopener"><button>[ open ↗ ]</button></a></div>
      <p class="lede" style="margin-top:8px">ტელევიზორზე გახსენი ეს ბმული. ორჯერ დააჭირე ეკრანს (ან F) სრული ეკრანისთვის. მაუსი თავისით იმალება.</p>
      <h3 class="sub">preview (live)</h3>
      <div class="preview" id="preview"><iframe src="${esc(tvUrl())}" title="TV preview" loading="lazy"></iframe></div>`;
  }

  function settings() {
    return `<h2 class="vh">settings</h2><p class="lede">ტურნირის სახელი, ქვესათაური და დაწყების დრო TV-ზე.</p>
      <div class="form-grid">
        <div><label for="sTitle">title</label><input id="sTitle" data-field="title" value="${esc(draft.title || "")}" maxlength="60"></div>
        <div><label for="sSub">subtitle</label><input id="sSub" data-field="subtitle" value="${esc(draft.subtitle || "")}" maxlength="80"></div>
        <div><label for="sGame">game · felt colour</label><select id="sGame" data-field="game">
          ${[["snooker", "სნუკერი · მწვანე"], ["pool", "პული · ლურჯი"], ["russian", "რუსული · ზურმუხტისფერი"]].map(([v, t]) => `<option value="${v}" ${draft.game === v ? "selected" : ""}>${v} :: ${t}</option>`).join("")}
        </select></div>
        <div><label for="sStart">start_time · TV-ზე უკუთვლა რეგისტრაციისას</label><input id="sStart" type="datetime-local" data-field="startAt" value="${esc(draft.startAt || "")}"></div>
      </div>`;
  }

  function history() {
    let h = []; try { h = JSON.parse(store.get(HIST_KEY) || "[]"); } catch (e) {}
    return `<h2 class="vh">history</h2><p class="lede">ბოლო შენახვები ამ მოწყობილობაზე. აღდგენა ჩატვირთავს ძველ ვერსიას; შენახვის შემდეგ TV-ზე გამოჩნდება.</p>
      <div class="table-wrap"><table><thead><tr><th>version</th><th>saved</th><th>players</th><th>results</th><th class="num"></th></tr></thead><tbody>
      ${h.length ? h.map((x, i) => {
        const st = DT.stats(x.data);
        return `<tr><td>v${x.v}</td><td>${x.at ? tbilisi.format(new Date(x.at)) : ""}</td><td>${st.players}</td><td>${st.done}/${st.total}</td>
          <td class="actions"><button data-restore="${i}" ${i === 0 ? "disabled" : ""}>აღდგენა</button></td></tr>`;
      }).join("") : `<tr><td class="empty" colspan="5">ჯერ არაფერი შენახულა</td></tr>`}
      </tbody></table></div>
      <h3 class="sub">audit_log</h3>
      <div class="table-wrap"><table><tbody>
      ${draft.log.length ? draft.log.map(l => `<tr><td class="num">${tbilisi.format(new Date(l.t))}</td><td>${esc(l.m)}</td></tr>`).join("") : `<tr><td class="empty">ცარიელია</td></tr>`}
      </tbody></table></div>`;
  }

  function danger() {
    return `<h2 class="vh">danger_zone</h2><p class="lede">ეს ქმედებები შენახვის შემდეგ მაშინვე ჩანს TV-ზე.</p>
      <section class="box danger"><div class="box-head">RESET_RESULTS</div><div class="box-body">
        <p>შლის ყველა შედეგს, ანგარიშს და LIVE ნიშანს. მოთამაშეები და წილისყრა რჩება.</p>
        <div class="confirm-row"><input id="cReset" placeholder="ჩაწერე RESET"><button class="danger-btn" data-act="reset-results">[ შედეგების წაშლა ]</button></div>
      </div></section>
      <section class="box danger"><div class="box-head">DELETE_TOURNAMENT</div><div class="box-body">
        <p>შლის ყველაფერს: მოთამაშეებს, ბადეს, შედეგებს. TV გადადის "ტურნირი მალე დაიწყება" ეკრანზე.</p>
        <div class="confirm-row"><input id="cDelete" placeholder="ჩაწერე DELETE"><button class="danger-btn" data-act="delete-all">[ ყველაფრის წაშლა ]</button></div>
      </div></section>
      <section class="box"><div class="box-head">BACKUP</div><div class="box-body">
        <p class="dim">ტურნირის ფაილად შენახვა და აღდგენა.</p>
        <div class="row"><button data-act="export">[ JSON ექსპორტი ]</button><input type="file" id="importFile" accept="application/json" style="max-width:260px"></div>
      </div></section>`;
  }

  /* ---------- actions ---------- */
  function bind(v) {
    const view = $("#view");
    view.onclick = e => {
      const t = e.target.closest("button"); if (!t) return;
      const act = t.dataset.act;
      if (act === "take-server") { const st = conflict; conflict = null; dirty = false; server.version = -2; adopt(st, true); return; }
      if (act === "force-save") { save(true); return; }
      if (t.dataset.filter) { filter = t.dataset.filter; render(); return; }
      // play screen
      if (act === "wiz-go") {
        let n = Math.max(2, Math.min(128, parseInt($("#wizN").value, 10) || 0));
        const names = $("#wizNames").value.split(/\r?\n/).map(x => x.replace(/^\s*\d+[\.\)]\s*/, "").trim()).filter(Boolean);
        if (names.length > n) n = Math.min(128, names.length);
        if (n < 2) return msg("მინიმუმ 2 მოთამაშე");
        const list = [];
        for (let k = 0; k < n; k++) list.push({ id: DT.uid(), name: (names[k] || `მოთამაშე ${k + 1}`).slice(0, 40) });
        now(`ახალი ტურნირი: ${n} მოთამაშე`, () => {
          draft.players = list;
          draft.bracket = DT.makeBracket(list, $("#wizRandom").checked);
          draft.status = "registration"; draft.breakInfo = null; draft.display = "auto";
        }, `ბადე შეიქმნა: ${n} მოთამაშე · TV-ზე უკვე ჩანს`);
        return;
      }
      if (act === "wiz-reset") {
        if (!confirm("ბადე წაიშლება და დაბრუნდები პირველ ნაბიჯზე. სახელები დარჩება. გავაგრძელო?")) return;
        now("ბადე წაიშალა", () => { draft.bracket = null; draft.status = "registration"; });
        return;
      }
      if (act === "new-tournament") {
        if (!confirm("ახალი ტურნირი? ეს ტურნირი წაიშლება (ისტორიაში დარჩება).")) return;
        now("ახალი ტურნირი", () => { const keep = { title: draft.title, subtitle: draft.subtitle, game: draft.game }; draft = Object.assign(DT.emptyData(), keep); });
        return;
      }
      if (act === "break-quick") { now("შესვენება", () => { draft.status = "break"; draft.breakInfo = { message: "", since: new Date().toISOString(), until: null }; }); return; }
      if (t.dataset.pwin) {
        const m = findMatch(t.dataset.pwin), id = t.dataset.pid;
        if (!DT.ready(m) || m.winner === id) return;
        const pos = (() => { const R = draft.bracket.rounds; for (let r = 0; r < R.length; r++) { const i = R[r].indexOf(m); if (i >= 0) return { r, i }; } })();
        const nx = DT.nextInfo(draft.bracket, pos.r, pos.i);
        now(`${pname(id)} მოიგო${m.score ? " " + m.score : ""}`, () => {
          m.winner = id; m.wo = false; m.live = false; m.doneAt = new Date().toISOString();
          if (draft.status === "registration") draft.status = "live";
          if (draft.announce && draft.announce.kind === "call" && draft.announce.on && draft.announce.text.includes(pname(id))) draft.announce.on = false;
          settle();
        }, nx.final ? `${pname(id)} ჩემპიონია!` : `${pname(id)} გადის ${loc(nx.round)} · TV განახლდა`);
        return;
      }
      if (t.dataset.pstart) {
        const m = findMatch(t.dataset.pstart);
        now(`გამოძახება: ${pname(m.a)} vs ${pname(m.b)}`, () => {
          m.live = true;
          if (draft.status === "registration") draft.status = "live";
          draft.announce = { on: true, kind: "call", text: `${pname(m.a)} vs ${pname(m.b)}${m.table ? " · მაგიდა " + m.table : ""}`, until: new Date(Date.now() + 90000).toISOString() };
        }, "მატჩი დაიწყო · TV-ზე გამოძახება ჩანს");
        return;
      }
      if (t.dataset.pstop) { const m = findMatch(t.dataset.pstop); now(`LIVE off: ${pname(m.a)} vs ${pname(m.b)}`, () => { m.live = false; }); return; }
      if (t.dataset.pundo) {
        const m = findMatch(t.dataset.pundo);
        if (!confirm(`გავაუქმო შედეგი: ${pname(m.winner)} მოიგო?`)) return;
        now(`შედეგი გაუქმდა: ${pname(m.a)} vs ${pname(m.b)}`, () => { m.winner = null; m.wo = false; m.doneAt = null; settle(); }, "შედეგი გაუქმდა");
        return;
      }


      // state
      if (act === "start") { now("ტურნირი დაიწყო", () => { draft.status = "live"; draft.breakInfo = null; if (draft.display === "players") draft.display = "auto"; }); return; }
      if (act === "break-open") { breakOpen = true; render(); return; }
      if (act === "break-close") { breakOpen = false; render(); return; }
      if (act === "break-go") {
        const mins = +(t.dataset.min || 0);
        const message = ($("#breakMsg") && $("#breakMsg").value.trim()) || "";
        breakOpen = false;
        now(mins ? `შესვენება ${mins} წთ` : "შესვენება (დროის გარეშე)", () => {
          draft.status = "break";
          draft.breakInfo = { message, since: new Date().toISOString(), until: mins ? new Date(Date.now() + mins * 60000).toISOString() : null };
        });
        return;
      }
      if (act === "extend") {
        now("შესვენება +5 წთ", () => { const b = draft.breakInfo || {}; const base = Math.max(Date.now(), b.until ? new Date(b.until).getTime() : 0); b.until = new Date(base + 5 * 60000).toISOString(); draft.breakInfo = b; });
        return;
      }
      if (act === "resume") { now("ტურნირი გაგრძელდა", () => { draft.status = "live"; draft.breakInfo = null; }); return; }
      if (act === "finish") {
        if (!DT.champion(draft) && !confirm("ფინალი ჯერ არ დასრულებულა. მაინც დავასრულო ტურნირი?")) return;
        now("ტურნირი დასრულდა", () => { draft.status = "finished"; draft.breakInfo = null; if (draft.announce) draft.announce.on = false; draft.bracket && draft.bracket.rounds.flat().forEach(m => { m.live = false; }); });
        return;
      }
      if (act === "reopen") { now("ტურნირი თავიდან გაიხსნა", () => { draft.status = "live"; }); return; }

      // matches
      if (t.dataset.win) {
        const m = findMatch(t.dataset.win), id = t.dataset.pid;
        if (!DT.ready(m)) return;
        m.winner = m.winner === id ? null : id;
        m.wo = false;
        m.doneAt = m.winner ? new Date().toISOString() : null;
        if (m.winner) m.live = false;
        settle();
        log(m.winner ? `${pname(id)} მოიგო${m.score ? " " + m.score : ""}` : `შედეგი გაუქმდა: ${pname(m.a)} vs ${pname(m.b)}`);
        changed(true); return;
      }
      if (t.dataset.live) { const m = findMatch(t.dataset.live); m.live = !m.live; log(`${m.live ? "LIVE" : "LIVE off"}: ${pname(m.a)} vs ${pname(m.b)}`); changed(true); return; }
      if (t.dataset.call) {
        const m = findMatch(t.dataset.call);
        now(`გამოძახება: ${pname(m.a)} vs ${pname(m.b)}`, () => {
          m.live = true;
          draft.announce = { on: true, kind: "call", text: `${pname(m.a)} vs ${pname(m.b)}${m.table ? " · მაგიდა " + m.table : ""}`, until: new Date(Date.now() + 90000).toISOString() };
        });
        return;
      }

      // players
      if (act === "up" || act === "down") {
        const i = draft.players.findIndex(p => p.id === t.dataset.id), j = act === "up" ? i - 1 : i + 1;
        [draft.players[i], draft.players[j]] = [draft.players[j], draft.players[i]]; changed(true); return;
      }
      if (act === "del") { const p = draft.players.find(x => x.id === t.dataset.id); draft.players = draft.players.filter(x => x.id !== t.dataset.id); log(`წაიშალა: ${p.name}`); changed(true); return; }
      if (act === "clear-players") { if (!confirm("ყველა მოთამაშის წაშლა?")) return; draft.players = []; log("სია გასუფთავდა"); changed(true); return; }
      if (act === "withdraw") {
        const p = draft.players.find(x => x.id === t.dataset.id);
        if (!confirm(`${p.name} მოიხსნება. მისი მეტოქე ავტომატურად გაიმარჯვებს (W/O). გავაგრძელო?`)) return;
        p.out = true; settle(); log(`მოიხსნა: ${p.name}`); changed(true); return;
      }
      if (act === "restore") { const p = draft.players.find(x => x.id === t.dataset.id); p.out = false; settle(); log(`დაბრუნდა: ${p.name}`); changed(true); return; }
      if (act === "bulk-add" || act === "bulk-replace") {
        const names = $("#bulk").value.split(/\r?\n/).map(s => s.replace(/^\s*\d+[\.\)]\s*/, "").trim()).filter(Boolean).slice(0, 128);
        if (!names.length) return msg("სია ცარიელია");
        const add = names.map(n => ({ id: DT.uid(), name: n.slice(0, 40) }));
        draft.players = act === "bulk-replace" ? add : draft.players.concat(add);
        log(`${add.length} მოთამაშე დაემატა`); changed(true); msg(`${add.length} მოთამაშე დაემატა`, true); return;
      }

      // draw
      if (act === "generate") {
        const active = draft.players.filter(p => !p.out);
        if (active.length < 2) return;
        const hasResults = draft.bracket && draft.bracket.rounds.flat().some(m => m.winner && !DT.isBye(m));
        if (hasResults && !confirm("ბადეს უკვე აქვს შედეგები. თავიდან შექმნა ყველაფერს წაშლის. გავაგრძელო?")) return;
        draft.bracket = DT.makeBracket(active, $("#randomDraw").checked);
        log("ბადე შეიქმნა");
        changed(true); msg("ბადე შეიქმნა. შეამოწმე წყვილები და შეინახე.", true); return;
      }
      if (act === "clear-bracket") { if (!confirm("ბადის წაშლა? შედეგებიც წაიშლება.")) return; draft.bracket = null; if (draft.status !== "registration") draft.status = "registration"; log("ბადე წაიშალა"); changed(true); return; }

      // announcements
      if (t.dataset.preset) { $("#annText").value = t.dataset.preset; return; }
      if (act === "ann-show") {
        const text = $("#annText").value.trim(); if (!text) return msg("ჩაწერე ტექსტი");
        now(`განცხადება: ${text}`, () => { draft.announce = { on: true, kind: "note", text, until: null }; });
        return;
      }
      if (act === "ann-hide") { now("განცხადება დაიმალა", () => { draft.announce = Object.assign({}, draft.announce, { on: false }); }); return; }

      // history
      if (t.dataset.restore) {
        let h = []; try { h = JSON.parse(store.get(HIST_KEY) || "[]"); } catch (err) {}
        const x = h[+t.dataset.restore]; if (!x) return;
        if (!confirm(`v${x.v} ვერსიის ჩატვირთვა? შენახვის შემდეგ TV-ზე გამოჩნდება.`)) return;
        draft = normalize(x.data); log(`აღდგა v${x.v}`); changed(true); msg("ვერსია ჩაიტვირთა. შეინახე, რომ TV-ზე გამოჩნდეს.", true); return;
      }

      // misc
      if (act === "copy") { navigator.clipboard && navigator.clipboard.writeText(tvUrl()).then(() => msg("ბმული დაკოპირდა", true)); return; }
      if (act === "reset-results") {
        if ($("#cReset").value.trim() !== "RESET") return msg("ჩაწერე RESET დასადასტურებლად");
        if (!draft.bracket) return;
        draft.bracket.rounds.flat().forEach(m => { m.winner = null; m.score = ""; m.live = false; m.doneAt = null; m.wo = false; });
        settle(); log("შედეგები წაიშალა"); changed(true); msg("შედეგები წაიშალა. შეინახე.", true); return;
      }
      if (act === "delete-all") {
        if ($("#cDelete").value.trim() !== "DELETE") return msg("ჩაწერე DELETE დასადასტურებლად");
        draft = DT.emptyData(); log("ტურნირი წაიშალა"); changed(true); msg("ტურნირი წაიშალა. შეინახე.", true); return;
      }
      if (act === "export") {
        const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "derby-tournament.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000); return;
      }
    };
    view.oninput = e => {
      const t = e.target;
      if (t.dataset.rename) { const p = draft.players.find(x => x.id === t.dataset.rename); if (p) { p.name = t.value.slice(0, 40); changed(); } }
      else if (t.dataset.score) { findMatch(t.dataset.score).score = t.value; markRow(t); changed(); }
      else if (t.dataset.table) { findMatch(t.dataset.table).table = t.value; markRow(t); changed(); }
      else if (t.dataset.field && t.tagName === "INPUT") { draft[t.dataset.field] = t.value; changed(); }
    };
    view.onchange = e => {
      const t = e.target;
      if (t.name === "disp") { draft.display = t.value; changed(); }
      if (t.dataset.field && t.tagName === "SELECT") { draft[t.dataset.field] = t.value; changed(); }
      if (t.dataset.swap) {
        const m = findMatch(t.dataset.swap), side = t.dataset.side, want = t.value, had = m[side];
        if (!want || want === had) return;
        // swap the two players' first-round places
        const other = draft.bracket.rounds[0].find(x => x.a === want || x.b === want);
        if (other) { if (other.a === want) other.a = had; else other.b = had; }
        m[side] = want;
        draft.bracket.rounds[0].forEach(x => { if (x === m || x === other) { x.winner = null; x.score = ""; x.wo = false; x.doneAt = null; } });
        settle(); log(`წყვილი შეიცვალა: ${pname(want)} ↔ ${pname(had)}`); changed(true);
      }
      if (t.id === "importFile" && t.files[0]) {
        t.files[0].text().then(txt => {
          try { const d = JSON.parse(txt); if (!d || !Array.isArray(d.players)) throw 0; draft = normalize(d); log("ფაილი ჩაიტვირთა"); changed(true); msg("ფაილი ჩაიტვირთა. შეინახე.", true); }
          catch (err) { msg("ფაილი არ არის DERBY ტურნირი"); }
        });
      }
    };
    const form = $("#addForm");
    if (form) form.onsubmit = e => {
      e.preventDefault();
      const name = $("#newName").value.trim(); if (!name) return;
      draft.players.push({ id: DT.uid(), name: name.slice(0, 40) });
      log(`დაემატა: ${name}`);
      changed(true); setTimeout(() => $("#newName") && $("#newName").focus(), 0);
    };
    if (v === "display") fitPreview();
  }
  function markRow(el) { const row = el.closest(".match"); if (row) row.classList.add("is-dirty"); }
  function fitPreview() {
    const box = $("#preview"); if (!box) return;
    box.querySelector("iframe").style.transform = `scale(${box.clientWidth / 1920})`;
  }
  addEventListener("resize", fitPreview);

  /* ---------- clock, break countdown refresh, boot ---------- */
  setInterval(() => {
    const c = $("#clock"); if (c) c.textContent = "tbilisi " + tbilisi.format(new Date());
  }, 1000);
  setInterval(() => { if (draft && draft.status === "break" && current() === "overview" && !document.activeElement.matches("input, textarea, select")) render(); }, 30000);
  $("#tvLink").href = tvUrl();
  health();
  stream();
  if (token) enter(); else showLogin();
})();
