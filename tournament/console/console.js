/* DERBY console: manage players, the draw and results; every save goes live on the TV */
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
  const TOKEN_KEY = "derby-t-token", BACKUP_KEY = "derby-t-backup", AUTO_KEY = "derby-t-autosave";

  let token = store.get(TOKEN_KEY);
  let server = { version: -1, updatedAt: null, data: null }; // last copy the server confirmed
  let draft = null;                                          // what you are editing
  let dirty = false, saving = false, conflict = null, viewers = 0, online = false;
  let filter = "all";

  /* ---------- small ui helpers ---------- */
  let msgT;
  function msg(text, ok) {
    const el = $("#message");
    el.textContent = text; el.className = ok ? "ok" : "";
    clearTimeout(msgT); msgT = setTimeout(() => { el.textContent = ""; }, ok ? 2500 : 6000);
  }
  function ballFor(id) {
    const i = draft.players.findIndex(p => p.id === id);
    if (i < 0) return "";
    return `<span class="b" style="--c:${COLORS[i % 8]}">${i + 1}</span>`;
  }
  const pname = id => { const p = draft.players.find(x => x.id === id); return p ? p.name : ""; };
  const tbilisi = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

  /* ---------- api ---------- */
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(DT.API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, cache: "no-store" });
    let body = null; try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  }

  async function health() {
    try {
      const r = await api("/api/health");
      online = r.status === 200; viewers = (r.body && r.body.viewers) || 0;
    } catch (e) { online = false; }
    paintNet();
    return online;
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
      if (r.status === 200 && r.body.token) {
        token = r.body.token; store.set(TOKEN_KEY, token); $("#password").value = "";
        await enter();
      } else if (r.status === 429) msg("ძალიან ბევრი მცდელობა. სცადე ერთ წუთში.");
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
    try {
      const r = await api("/api/state");
      adopt(r.body, true);
    } catch (e) { msg("სერვერი ჯერ არ პასუხობს. ვცდილობ თავიდან."); setTimeout(enter, 4000); }
  }

  /* ---------- state in / out ---------- */
  function adopt(st, first) {
    if (!st || typeof st.version !== "number") return;
    if (st.version === server.version && !first) return;
    if (saving && !first) return; // our own save echoing back; the save response updates us
    if (dirty && !first && JSON.stringify(st.data) === JSON.stringify(draft)) { server = clone(st); dirty = false; render(); return; }
    // the free server forgets everything after a restart; put the last saved copy back
    if (st.version === 0 && !st.data && token) {
      const backup = (() => { try { return JSON.parse(store.get(BACKUP_KEY) || "null"); } catch (e) { return null; } })();
      if (backup && backup.data) {
        server = st; draft = clone(backup.data); dirty = true;
        render(); save(true, "სერვერი გადაიტვირთა: ბოლო შენახული ვერსია აღდგა");
        return;
      }
    }
    if (dirty && !first) { conflict = st; server.versionSeen = st.version; render(); return; }
    server = clone(st);
    draft = Object.assign(DT.emptyData(), clone(st.data || {}));
    if (!Array.isArray(draft.players)) draft.players = [];
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
        dirty = false; conflict = null;
        msg(okText || `შენახულია · v${r.body.version} · TV განახლდა`, true);
      } else if (r.status === 401) kicked();
      else if (r.status === 409) { conflict = r.body.state; msg("სხვა ეკრანიდან უკვე შეინახა. აირჩიე რომელი ვერსია დარჩეს."); }
      else msg("შენახვა ვერ მოხერხდა: " + ((r.body && r.body.error) || r.status));
    } catch (e) { msg("შენახვა ვერ მოხერხდა: სერვერთან კავშირი არ არის"); }
    saving = false;
    render();
  }
  $("#saveBtn").addEventListener("click", () => save());
  addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
  $("#autosave").checked = store.get(AUTO_KEY) === "1";
  $("#autosave").addEventListener("change", e => { store.set(AUTO_KEY, e.target.checked ? "1" : "0"); if (e.target.checked && dirty) save(); });
  addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function paintStatus() {
    const s = $("#sbState");
    s.className = "sb-state" + (saving ? " saving" : dirty ? " dirty" : "");
    s.textContent = saving ? "saving..." : dirty ? "unsaved changes" : "synced";
    $("#saveBtn").disabled = !dirty || saving;
    const t = server.updatedAt ? tbilisi.format(new Date(server.updatedAt)) : "never";
    $("#sbMeta").textContent = `v${Math.max(0, server.version)} · last save ${t} · ${viewers} screen${viewers === 1 ? "" : "s"} online`;
  }

  /* ---------- live stream: keeps two consoles and the TV in step ---------- */
  let es;
  function stream() {
    try { es && es.close(); } catch (e) {}
    es = new EventSource(DT.API + "/api/stream");
    es.addEventListener("state", e => { online = true; paintNet(); if (token && !$("#app").hidden) { try { adopt(JSON.parse(e.data)); } catch (err) {} } });
    es.onerror = () => { online = false; paintNet(); };
  }

  /* ---------- router ---------- */
  const views = { overview, players, draw, matches, display, settings, danger };
  function current() { const v = location.hash.replace(/^#\//, ""); return views[v] ? v : "overview"; }
  addEventListener("hashchange", () => { document.body.classList.remove("side-open"); render(); });
  $("#menuBtn").addEventListener("click", () => document.body.classList.toggle("side-open"));

  function render() {
    if (!draft) return;
    const v = current();
    $$("#side a").forEach(a => a.classList.toggle("on", a.dataset.view === v));
    const y = scrollY;
    $("#view").innerHTML = conflictNotice() + views[v]();
    bind(v);
    scrollTo(0, y);
    paintStatus();
  }

  function conflictNotice() {
    if (!conflict) return "";
    return `<div class="notice warn">სერვერზე ახალი ვერსიაა (v${conflict.version}), შენ კი შეუნახავი ცვლილებები გაქვს.
      <button data-act="take-server">სერვერის ვერსიის ჩატვირთვა</button><button data-act="force-save">ჩემი ვერსიის შენახვა</button></div>`;
  }

  /* ---------- views ---------- */
  function overview() {
    const st = DT.stats(draft), br = draft.bracket;
    const roundName = br && st.round !== null ? DT.roundName(br.rounds[st.round].length) : "n/a";
    const champ = DT.champion(draft);
    const lives = br ? br.rounds.flat().filter(m => m.live && !m.winner) : [];
    let next = "";
    if (!draft.players.length) next = `<div class="notice">step 1 :: დაამატე მოთამაშეები <a href="#/players">players →</a></div>`;
    else if (!br) next = `<div class="notice">step 2 :: შექმენი ბადე <a href="#/draw">draw →</a></div>`;
    else if (champ) next = `<div class="notice ok">ტურნირი დასრულდა · ჩემპიონი: ${esc(pname(champ))}</div>`;
    else next = `<div class="notice">step 3 :: ჩაწერე შედეგები <a href="#/matches">matches →</a></div>`;
    return `<h2 class="vh">overview</h2><p class="lede">${esc(draft.title)} · ${esc(draft.subtitle || "")}</p>
      ${next}
      <div class="stats">
        <div class="stat"><span>players</span><b>${st.players}</b></div>
        <div class="stat ok"><span>matches_done</span><b>${st.done}/${st.total}</b></div>
        <div class="stat live"><span>live_now</span><b>${st.live}</b></div>
        <div class="stat"><span>current_round</span><b style="font-size:15px">${esc(roundName)}</b></div>
        <div class="stat ${online ? "ok" : "warn"}"><span>server</span><b>${online ? "online" : "offline"}</b></div>
        <div class="stat"><span>screens</span><b>${viewers}</b></div>
      </div>
      <h3 class="sub">live_matches</h3>
      ${lives.length ? `<div class="table-wrap"><table><tbody>${lives.map(m => `<tr><td>${ballFor(m.a)} ${esc(pname(m.a))}</td><td class="num">vs</td><td>${ballFor(m.b)} ${esc(pname(m.b))}</td><td class="num">${m.table ? "table " + esc(m.table) : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="dim">ახლა LIVE მატჩი არ არის. matches-ში ჩართე LIVE.</p>`}
      <h3 class="sub">tv_link</h3>
      <p><code class="k">${esc(tvUrl())}</code></p>`;
  }

  function players() {
    const locked = !!draft.bracket;
    return `<h2 class="vh">players</h2><p class="lede">${draft.players.length} registered · TV-ზე ჩანს ბადის შექმნამდე</p>
      ${locked ? `<div class="notice warn">ბადე უკვე შექმნილია. სახელების შესწორება შეიძლება; დამატება ან წაშლა მოითხოვს ბადის თავიდან შექმნას (<a href="#/draw">draw</a>).</div>` : ""}
      <form class="toolbar" id="addForm">
        <input id="newName" placeholder="მოთამაშის სახელი" maxlength="40" autocomplete="off" ${locked ? "disabled" : ""}>
        <button class="primary" ${locked ? "disabled" : ""}>[ + დამატება ]</button>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th class="num">#</th><th>name</th><th class="num"></th></tr></thead>
        <tbody>${draft.players.length ? draft.players.map((p, i) => `
          <tr><td class="num">${ballFor(p.id)}</td>
          <td><input class="cell" data-rename="${p.id}" value="${esc(p.name)}" maxlength="40"></td>
          <td class="actions">
            <button data-act="up" data-id="${p.id}" ${locked || i === 0 ? "disabled" : ""}>↑</button>
            <button data-act="down" data-id="${p.id}" ${locked || i === draft.players.length - 1 ? "disabled" : ""}>↓</button>
            <button class="danger-btn" data-act="del" data-id="${p.id}" ${locked ? "disabled" : ""}>წაშლა</button>
          </td></tr>`).join("") : `<tr><td class="empty" colspan="3">ჯერ მოთამაშე არ არის</td></tr>`}</tbody>
      </table></div>
      <h3 class="sub">bulk_import</h3>
      <p class="lede">ჩასვი სია Excel-იდან ან ჩატიდან: ერთი სახელი ერთ ხაზზე.</p>
      <textarea id="bulk" placeholder="გიორგი&#10;ლევანი&#10;ნიკა" ${locked ? "disabled" : ""}></textarea>
      <div class="row" style="margin-top:8px">
        <button data-act="bulk-add" ${locked ? "disabled" : ""}>[ დამატება სიაში ]</button>
        <button data-act="bulk-replace" ${locked ? "disabled" : ""}>[ სიის ჩანაცვლება ]</button>
      </div>`;
  }

  function draw() {
    const n = draft.players.length, size = n >= 2 ? (() => { let s = 2; while (s < n) s *= 2; return s; })() : 0;
    const byes = size ? size - n : 0, br = draft.bracket;
    const results = br ? br.rounds.flat().filter(m => m.winner && !DT.isBye(m)).length : 0;
    return `<h2 class="vh">draw</h2><p class="lede">ნოკაუტ სისტემა: წაგებული ტოვებს ტურნირს, გამარჯვებული ავტომატურად გადადის შემდეგ ეტაპზე.</p>
      <div class="stats">
        <div class="stat"><span>players</span><b>${n}</b></div>
        <div class="stat"><span>bracket_size</span><b>${size || "n/a"}</b></div>
        <div class="stat"><span>byes</span><b>${byes}</b></div>
        <div class="stat"><span>first_round_matches</span><b>${size ? size / 2 - byes : 0}</b></div>
      </div>
      ${byes ? `<p class="lede">${byes} მოთამაშე პირდაპირ გადადის მეორე წრეში (bye), რადგან ${n} არ არის 2-ის ხარისხი. ისინი წილისყრით განაწილდება თანაბრად.</p>` : ""}
      ${br ? `<div class="notice warn">ბადე უკვე არსებობს${results ? `, ${results} შედეგით` : ""}. თავიდან შექმნა წაშლის ყველა შედეგს.</div>` : ""}
      <label class="row" style="color:var(--ink);font-size:14px;margin-bottom:12px"><input type="checkbox" id="randomDraw" checked> შემთხვევითი წილისყრა (გამორთვისას: სიის რიგით)</label>
      <div class="row">
        <button class="primary" data-act="generate" ${n < 2 ? "disabled" : ""}>[ ${br ? "ბადის თავიდან შექმნა" : "ბადის შექმნა"} ]</button>
        ${br ? `<button class="danger-btn" data-act="clear-bracket">[ ბადის წაშლა ]</button>` : ""}
      </div>
      ${br ? `<h3 class="sub">first_round</h3><div class="table-wrap"><table><tbody>${br.rounds[0].map((m, i) => `<tr><td class="num">M${i + 1}</td><td>${m.a === DT.BYE ? "<span class='dim'>bye</span>" : ballFor(m.a) + " " + esc(pname(m.a))}</td><td class="num">vs</td><td>${m.b === DT.BYE ? "<span class='dim'>bye</span>" : ballFor(m.b) + " " + esc(pname(m.b))}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  }

  function matches() {
    const br = draft.bracket;
    if (!br) return `<h2 class="vh">matches</h2><div class="notice">ჯერ შექმენი ბადე <a href="#/draw">draw →</a></div>`;
    const sv = server.data && server.data.bracket;
    const svMatch = id => sv ? sv.rounds.flat().find(m => m.id === id) : null;
    const show = m => filter === "all" ? true : filter === "open" ? (DT.ready(m) && !m.winner) : filter === "live" ? (m.live && !m.winner) : !!m.winner;
    let html = `<h2 class="vh">matches</h2><p class="lede">დააჭირე გამარჯვებულის სახელს, მერე [ შენახვა ]. ანგარიში არასავალდებულოა, მაგ: 3-1.</p>
      <div class="toolbar">${["all", "open", "live", "done"].map(f => `<button data-filter="${f}" class="${filter === f ? "primary" : ""}">${f}</button>`).join("")}</div>`;
    let num = 0;
    br.rounds.forEach((row, r) => {
      const real = row.filter(m => !DT.isBye(m));
      const list = real.filter(show);
      const byes = row.length - real.length;
      num += 0;
      if (!list.length) return;
      html += `<div class="round-h"><b>${esc(DT.roundName(row.length))}</b><span>${real.filter(m => m.winner).length}/${real.length} done${byes ? ` · ${byes} bye` : ""}</span></div>
        <div class="match head"><span>id</span><span>table</span><span>player_a</span><span>score</span><span>player_b</span><span>live</span><span class="status">status</span></div>`;
      list.forEach(m => {
        const i = row.indexOf(m);
        const ready = DT.ready(m);
        const s0 = svMatch(m.id);
        const isDirty = !s0 || s0.winner !== m.winner || (s0.score || "") !== (m.score || "") || (s0.table || "") !== (m.table || "") || !!s0.live !== !!m.live;
        const pick = id => {
          if (!id) return `<button class="pick tbd" disabled><span>ელოდება</span></button>`;
          const cls = m.winner ? (m.winner === id ? " win" : " lose") : "";
          return `<button class="pick${cls}" data-win="${m.id}" data-pid="${id}" ${ready ? "" : "disabled"}>${ballFor(id)}<span>${esc(pname(id))}</span></button>`;
        };
        const status = m.winner ? `<span class="status done">done</span>` : m.live ? `<span class="status live">● live</span>` : ready ? `<span class="status wait">ready</span>` : `<span class="status wait">waiting</span>`;
        html += `<div class="match${isDirty ? " is-dirty" : ""}" data-mid="${m.id}">
          <span class="mid">R${r + 1}·M${i + 1}</span>
          <input class="tbl" data-table="${m.id}" value="${esc(m.table || "")}" placeholder="table" maxlength="4">
          <div class="pa">${pick(m.a)}</div>
          <input class="sc" data-score="${m.id}" value="${esc(m.score || "")}" placeholder="0-0" maxlength="9" ${ready ? "" : "disabled"}>
          <div class="pb">${pick(m.b)}</div>
          <button class="lv live-btn${m.live && !m.winner ? " on" : ""}" data-live="${m.id}" ${ready && !m.winner ? "" : "disabled"}>LIVE</button>
          ${status}
        </div>`;
      });
    });
    return html;
  }

  function tvUrl() { return new URL("../", location.href).href.replace(/\?.*$/, ""); }

  function display() {
    const d = draft.display || "auto";
    const opt = (v, t) => `<label><input type="radio" name="disp" value="${v}" ${d === v ? "checked" : ""}> ${t}</label>`;
    return `<h2 class="vh">display</h2><p class="lede">რა ჩანს ტელევიზორზე. ცვლილება ჩანს შენახვის შემდეგ.</p>
      <div class="radio-list">
        ${opt("auto", "auto :: მოთამაშეების სია, ბადის შექმნის შემდეგ ბადე")}
        ${opt("players", "players :: მხოლოდ რეგისტრირებული მოთამაშეები")}
        ${opt("bracket", "bracket :: მხოლოდ ბადე და შედეგები")}
      </div>
      <h3 class="sub">tv_link</h3>
      <div class="row"><code class="k" id="tvUrl">${esc(tvUrl())}</code><button data-act="copy">[ copy ]</button><a href="${esc(tvUrl())}" target="_blank" rel="noopener"><button>[ open ↗ ]</button></a></div>
      <p class="lede" style="margin-top:8px">ტელევიზორზე გახსენი ეს ბმული ბრაუზერში. ორჯერ დააჭირე ეკრანს (ან F ღილაკი) სრული ეკრანისთვის. მაუსი თავისით იმალება.</p>
      <h3 class="sub">preview (live)</h3>
      <div class="preview" id="preview"><iframe src="${esc(tvUrl())}" title="TV preview" loading="lazy"></iframe></div>`;
  }

  function settings() {
    return `<h2 class="vh">settings</h2><p class="lede">ტურნირის სახელი და ქვესათაური TV-ს თავში.</p>
      <div class="form-grid">
        <div><label for="sTitle">title</label><input id="sTitle" data-field="title" value="${esc(draft.title || "")}" maxlength="60"></div>
        <div><label for="sSub">subtitle</label><input id="sSub" data-field="subtitle" value="${esc(draft.subtitle || "")}" maxlength="80"></div>
        <div><label for="sGame">game</label><select id="sGame" data-field="game">
          ${[["snooker", "სნუკერი"], ["pool", "პული"], ["russian", "რუსული ბილიარდი"]].map(([v, t]) => `<option value="${v}" ${draft.game === v ? "selected" : ""}>${v} :: ${t}</option>`).join("")}
        </select></div>
      </div>`;
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
        <div class="row"><button data-act="export">[ JSON ექსპორტი ]</button><label class="row" style="color:var(--ink)"><input type="file" id="importFile" accept="application/json" style="max-width:260px"></label></div>
      </div></section>`;
  }

  /* ---------- actions ---------- */
  function findMatch(id) { return draft.bracket.rounds.flat().find(m => m.id === id); }

  function bind(v) {
    const view = $("#view");
    view.onclick = e => {
      const t = e.target.closest("button"); if (!t) return;
      const act = t.dataset.act;
      if (act === "take-server") { const st = conflict; conflict = null; dirty = false; server.version = -2; adopt(st, true); return; }
      if (act === "force-save") { save(true); return; }
      if (t.dataset.filter) { filter = t.dataset.filter; render(); return; }
      if (t.dataset.win) {
        const m = findMatch(t.dataset.win), id = t.dataset.pid;
        if (!DT.ready(m)) return;
        m.winner = m.winner === id ? null : id;
        m.doneAt = m.winner ? new Date().toISOString() : null;
        if (m.winner) m.live = false;
        DT.settle(draft.bracket);
        changed(true); return;
      }
      if (t.dataset.live) { const m = findMatch(t.dataset.live); m.live = !m.live; changed(true); return; }
      if (act === "up" || act === "down") {
        const i = draft.players.findIndex(p => p.id === t.dataset.id), j = act === "up" ? i - 1 : i + 1;
        [draft.players[i], draft.players[j]] = [draft.players[j], draft.players[i]]; changed(true); return;
      }
      if (act === "del") { draft.players = draft.players.filter(p => p.id !== t.dataset.id); changed(true); return; }
      if (act === "bulk-add" || act === "bulk-replace") {
        const names = $("#bulk").value.split(/\r?\n/).map(s => s.replace(/^\s*\d+[\.\)]\s*/, "").trim()).filter(Boolean).slice(0, 128);
        if (!names.length) return msg("სია ცარიელია");
        const add = names.map(n => ({ id: DT.uid(), name: n.slice(0, 40) }));
        draft.players = act === "bulk-replace" ? add : draft.players.concat(add);
        changed(true); msg(`${add.length} მოთამაშე დაემატა`, true); return;
      }
      if (act === "generate") {
        if (draft.players.length < 2) return;
        const hasResults = draft.bracket && draft.bracket.rounds.flat().some(m => m.winner && !DT.isBye(m));
        if (hasResults && !confirm("ბადეს უკვე აქვს შედეგები. თავიდან შექმნა ყველაფერს წაშლის. გავაგრძელო?")) return;
        draft.bracket = DT.makeBracket(draft.players, $("#randomDraw").checked);
        if (draft.display === "players") draft.display = "auto";
        changed(); location.hash = "#/matches"; msg("ბადე შეიქმნა. შეინახე, რომ TV-ზე გამოჩნდეს.", true); return;
      }
      if (act === "clear-bracket") { if (!confirm("ბადის წაშლა? შედეგებიც წაიშლება.")) return; draft.bracket = null; changed(true); return; }
      if (act === "copy") { navigator.clipboard && navigator.clipboard.writeText(tvUrl()).then(() => msg("ბმული დაკოპირდა", true)); return; }
      if (act === "reset-results") {
        if ($("#cReset").value.trim() !== "RESET") return msg("ჩაწერე RESET დასადასტურებლად");
        if (!draft.bracket) return;
        draft.bracket.rounds.flat().forEach(m => { m.winner = null; m.score = ""; m.live = false; m.doneAt = null; });
        DT.settle(draft.bracket); changed(true); msg("შედეგები წაიშალა. შეინახე.", true); return;
      }
      if (act === "delete-all") {
        if ($("#cDelete").value.trim() !== "DELETE") return msg("ჩაწერე DELETE დასადასტურებლად");
        draft = DT.emptyData(); changed(true); msg("ტურნირი წაიშალა. შეინახე.", true); return;
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
      else if (t.dataset.field) { draft[t.dataset.field] = t.value; changed(); }
    };
    view.onchange = e => {
      const t = e.target;
      if (t.name === "disp") { draft.display = t.value; changed(); }
      if (t.dataset.field && t.tagName === "SELECT") { draft[t.dataset.field] = t.value; changed(); }
      if (t.id === "importFile" && t.files[0]) {
        t.files[0].text().then(txt => {
          try { const d = JSON.parse(txt); if (!d || !Array.isArray(d.players)) throw 0; draft = d; changed(true); msg("ფაილი ჩაიტვირთა. შეინახე.", true); }
          catch (err) { msg("ფაილი არ არის DERBY ტურნირი"); }
        });
      }
    };
    const form = $("#addForm");
    if (form) form.onsubmit = e => {
      e.preventDefault();
      const name = $("#newName").value.trim(); if (!name) return;
      draft.players.push({ id: DT.uid(), name: name.slice(0, 40) });
      changed(true); setTimeout(() => $("#newName") && $("#newName").focus(), 0);
    };
    if (v === "display") fitPreview();
  }
  function markRow(el) { const row = el.closest(".match"); if (row) row.classList.add("is-dirty"); }
  function fitPreview() {
    const box = $("#preview"); if (!box) return;
    const f = box.querySelector("iframe"); f.style.transform = `scale(${box.clientWidth / 1920})`;
  }
  addEventListener("resize", fitPreview);

  /* ---------- clock + boot ---------- */
  setInterval(() => { const c = $("#clock"); if (c) c.textContent = "tbilisi " + tbilisi.format(new Date()); }, 1000);
  $("#tvLink").href = tvUrl();
  health();
  stream();
  if (token) enter(); else showLogin();
})();
