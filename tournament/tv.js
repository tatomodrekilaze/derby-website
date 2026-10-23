/* DERBY tournament: live TV display (broadcast style) */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const pad = n => String(n).padStart(2, "0");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const COLORS = ["#f4c22b", "#1f4fbf", "#d8262e", "#5b2a91", "#f2741c", "#11804a", "#7c1e26", "#141519"];
  const stage = $("#stage"), main = $("#tvMain");
  const HEAD_H = 40;
  const mainH = () => (stage.classList.contains("has-ann") ? 860 - 104 : 860); // room for the announcement strip
  let scale = 1, data = null, prevWinners = null, prevChamp = undefined, mode = "";

  /* ---------- fit the 1920x1080 stage to any screen ---------- */
  function fit() {
    const portrait = innerWidth < 760 && innerHeight > innerWidth;
    document.documentElement.classList.toggle("portrait", portrait);
    if (portrait) { stage.style.transform = ""; scale = 1; }
    else { scale = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(-50%, -50%) scale(${scale})`; }
    requestAnimationFrame(drawLinks);
  }
  addEventListener("resize", fit);
  fit();

  /* ---------- helpers ---------- */
  const players = () => (data && data.players) || [];
  const byId = id => players().find(p => p.id === id);
  const name = id => { const p = byId(id); return p ? p.name : ""; };
  function dot(id) {
    const i = players().findIndex(p => p.id === id);
    if (i < 0) return `<i class="dot dot--none"></i>`;
    return `<i class="dot${(i % 16) >= 8 ? " dot--stripe" : ""}" style="--c:${COLORS[i % 8]}"></i>`;
  }
  function scores(mt) {
    const m = String(mt.score || "").match(/(\d+)\s*[-:/ ]\s*(\d+)/);
    return m ? [m[1], m[2]] : ["", ""];
  }
  function allMatches() {
    const out = [], br = data && data.bracket;
    if (br) br.rounds.forEach((row, r) => row.forEach((mt, i) => { if (!DT.isBye(mt)) out.push({ mt, r, i, round: DT.roundName(row.length, r) }); }));
    return out;
  }

  /* ---------- clock ---------- */
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function tickClock() { $("#tvClock").textContent = fmt.format(new Date()); }
  tickClock(); setInterval(tickClock, 5000);

  /* ---------- render ---------- */
  function render(isUpdate) {
    document.documentElement.dataset.game = data.game || "snooker";
    $("#tvTitle").textContent = data.title || "DERBY";
    $("#tvSub").textContent = data.subtitle || "";
    document.title = `DERBY · ${data.title || "ტურნირი"} LIVE`;
    const br = data.bracket, status = DT.STATUS[data.status] ? data.status : "registration";
    const pill = $("#statePill");
    pill.className = "live-pill st-" + status;
    pill.querySelector("span").textContent = status === "live" ? "LIVE" : DT.STATUS[status].ka;
    const want = data.display === "players" ? (players().length ? "players" : "wait")
      : data.display === "bracket" && br ? "bracket"
      : status === "registration" ? (players().length ? "players" : br ? "bracket" : "wait")
      : br ? "bracket" : players().length ? "players" : "wait";
    if (want === "players") renderLineup(isUpdate && mode === "players");
    else if (want === "bracket") renderBoard();
    else renderWait();
    mode = want;
    paintOverlays();
  }

  function renderWait() {
    const at = startDate();
    main.innerHTML = `<div class="tv-wait"><img src="../assets/img/crest.png" alt=""><p>ტურნირი მალე დაიწყება</p>
      <small>${at ? "დაწყება " + fmt.format(at) + "-ზე" : "რეგისტრაცია მიმდინარეობს"}</small>
      ${at ? `<div class="cd" data-at="${at.toISOString()}" data-kind="big"></div>` : ""}</div>`;
  }

  function renderLineup(keep) {
    const list = players(), n = list.length;
    const cols = n <= 10 ? 1 : n <= 24 ? 2 : n <= 42 ? 3 : 4;
    const rows = Math.max(1, Math.ceil(n / cols));
    const ph = Math.min(72, Math.floor(820 / rows));
    const pf = Math.round(Math.min(38, ph * .55));
    main.innerHTML = `
      <section class="lineup">
        <div class="lineup__side">
          <small>რეგისტრაცია</small>
          <b>${list.filter(p => !p.out).length}</b>
          <span>მოთამაშე</span>
          <p>${esc(data.title || "")}${data.subtitle ? "<br>" + esc(data.subtitle) : ""}</p>
          ${startDate() && data.status === "registration" ? `<div class="cd" data-at="${startDate().toISOString()}" data-kind="line"></div>` : ""}
        </div>
        <div class="lineup__list" style="--rows:${rows};--ph:${ph}px;--pf:${pf}px">
          ${list.map((p, i) => `<div class="pl-row${p.out ? " is-out" : ""}" style="--i:${keep ? 0 : i}"><em>${i + 1}</em>${dot(p.id)}<span>${esc(p.name)}</span></div>`).join("")}
        </div>
      </section>`;
    requestAnimationFrame(fitNames);
  }

  function renderBoard() {
    main.innerHTML = `<section class="board">${bracketHTML()}${asideHTML()}</section>`;
    requestAnimationFrame(() => { fitNames(); drawLinks(); });
  }

  // long Georgian names shrink a little to fit instead of being cut with "..."
  function fitNames() {
    $$(".r__n, .feat__row span, .list__row b, .pl-row span, .champ-card b").forEach(el => {
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize);
      let fs = base;
      while (el.scrollWidth > el.clientWidth + 1 && fs > base * .62) { fs -= 1; el.style.fontSize = fs + "px"; }
    });
  }
  if (document.fonts) document.fonts.ready.then(() => { fitNames(); drawLinks(); });

  function bracketHTML() {
    const R = data.bracket.rounds, U = R[0].length, st = DT.stats(data);
    const unit = (mainH() - HEAD_H) / U;
    // early rounds hold real names, later ones mostly empty slots: give the early ones more room
    const cols = R.map((_, r) => (r < 2 && R.length > 3 ? "1.12fr" : "1fr")).join(" ");
    let html = `<div class="bracket" id="bracket" style="grid-template-columns:${cols}">`;
    R.forEach((row, r) => {
      const span = 2 ** r, real = row.filter(m => !DT.isBye(m));
      const baseRh = Math.max(14, Math.min(46, (unit * span - 12) / 2));
      html += `<div class="round${st.round === r ? " is-current" : ""}">
        <div class="round__head"><b>${esc(DT.roundName(row.length, r))}</b><span>${real.filter(m => m.winner).length}/${real.length}</span></div>
        <div class="round__slots" style="--units:${U}">`;
      row.forEach((mt, i) => {
        if (DT.isBye(mt)) return;
        const [sa, sb] = scores(mt), fin = r === R.length - 1;
        // a first-round match with byes on both sides can spill into the empty rows around it
        const roomy = r === 0 && (i === 0 || DT.isBye(row[i - 1])) && (i === row.length - 1 || DT.isBye(row[i + 1]));
        const rh = roomy ? Math.min(40, (unit * 2.6 - 12) / 2) : baseRh;
        const fs = Math.round(Math.max(13, Math.min(25, rh * .56)));
        const side = (id, s) => {
          if (!id) return `<div class="r is-tbd"><i class="dot dot--none"></i><span class="r__n">ელოდება</span></div>`;
          const out = (byId(id) || {}).out;
          const cls = (mt.winner ? (mt.winner === id ? " is-win" : " is-lose") : "") + (mt.wo ? " is-wo" : "") + (out && !mt.winner ? " is-out" : "");
          const sc = mt.wo ? (mt.winner === id ? "" : "W/O") : s;
          return `<div class="r${cls}">${dot(id)}<span class="r__n">${esc(name(id))}</span><b class="r__s">${esc(sc)}</b></div>`;
        };
        html += `<div class="m${mt.live && !mt.winner ? " is-live" : ""}${mt.winner ? " is-done" : ""}${fin ? " is-final" : ""}"
          data-id="${mt.id}" data-r="${r}" data-i="${i}" style="grid-row:${i * span + 1} / span ${span};--rh:${rh}px;--fs:${fs}px">
          ${side(mt.a, sa)}${side(mt.b, sb)}
        </div>`;
      });
      html += `</div></div>`;
    });
    return html + `<svg class="links" id="links"></svg></div>`;
  }

  function featHTML(x, small) {
    const { mt, round } = x, [sa, sb] = scores(mt);
    const longest = Math.max(name(mt.a).length, name(mt.b).length, 6);
    const ff = Math.max(26, Math.min(small ? 36 : 50, Math.floor(330 / (longest * .66))));
    const row = (id, s) => `<div class="feat__row">${dot(id)}<span>${esc(name(id))}</span><b>${esc(s)}</b></div>`;
    return `<div class="feat" style="--ff:${ff}px">
      <div class="feat__meta">${mt.table ? `<b>მაგიდა ${esc(mt.table)}</b>` : ""}<span>${esc(round)}</span></div>
      ${row(mt.a, sa)}<div class="feat__vs">VS</div>${row(mt.b, sb)}
    </div>`;
  }

  function asideHTML() {
    const all = allMatches(), st = DT.stats(data), champ = DT.champion(data);
    const live = all.filter(x => x.mt.live && !x.mt.winner);
    const ready = DT.waiting(data).map(x => all.find(a => a.mt.id === x.mt.id));
    const done = all.filter(x => x.mt.winner).sort((a, b) => (b.mt.doneAt || "").localeCompare(a.mt.doneAt || ""));
    let top;
    if (champ) {
      const fin = all.find(x => x.r === data.bracket.rounds.length - 1);
      top = `<h4>ტურნირი დასრულდა</h4><div class="champ-card"><small>ჩემპიონი</small><b>${esc(name(champ))}</b></div>`;
      if (fin && fin.mt.score) top += `<div class="list__row" style="margin-top:12px">ფინალი <span class="sc">${esc(fin.mt.score)}</span></div>`;
    } else if (live.length) {
      top = `<h4>ახლა მაგიდაზე <span class="live-pill"><i></i>LIVE</span></h4>` + live.slice(0, 2).map(x => featHTML(x, live.length > 1)).join("");
    } else if (ready.length) {
      top = `<h4>შემდეგი მატჩი</h4>` + featHTML(ready.shift(), false);
    } else {
      top = `<h4>ახლა მაგიდაზე</h4><p class="empty">მატჩი ჯერ არ დაწყებულა</p>`;
    }
    const next = champ ? [] : ready.slice(0, live.length > 1 ? 2 : 3);
    const res = done.slice(0, live.length > 1 ? 2 : 3);
    const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    return `<aside class="aside">
      ${top}
      ${next.length ? `<div class="list"><h4>შემდეგი</h4>${next.map(x => `<div class="list__row"><b>${esc(name(x.mt.a))}</b><i>vs</i><b>${esc(name(x.mt.b))}</b></div>`).join("")}</div>` : ""}
      ${res.length ? `<div class="list"><h4>შედეგები</h4>${res.map(x => {
        const lose = x.mt.winner === x.mt.a ? x.mt.b : x.mt.a;
        return `<div class="list__row"><b>${esc(name(x.mt.winner))}</b>${x.mt.score ? `<span class="sc">${esc(x.mt.score)}</span>` : `<i>vs</i>`}<i>${esc(name(lose))}</i></div>`;
      }).join("")}</div>` : ""}
      <div class="prog">
        <div class="prog__txt"><span>მატჩი</span><span><b>${st.done}</b> / ${st.total}</span></div>
        <div class="prog__track" style="--p:${pct}%"><span class="prog__cue"></span><span class="prog__ball"></span></div>
      </div>
    </aside>`;
  }

  // thin elbow lines from each match to the one its winner goes to
  function drawLinks() {
    const wrap = $("#bracket"), svg = $("#links");
    if (!wrap || !svg || document.documentElement.classList.contains("portrait")) return;
    const base = wrap.getBoundingClientRect(), s = scale || 1, R = data.bracket.rounds;
    const box = el => { const r = el.getBoundingClientRect(); return { l: (r.left - base.left) / s, r: (r.right - base.left) / s, y: (r.top + r.height / 2 - base.top) / s }; };
    let d = "";
    for (let r = 1; r < R.length; r++) {
      R[r].forEach((mt, i) => {
        const to = wrap.querySelector(`.m[data-r="${r}"][data-i="${i}"]`); if (!to) return;
        const t = box(to);
        [i * 2, i * 2 + 1].forEach(fi => {
          const from = wrap.querySelector(`.m[data-r="${r - 1}"][data-i="${fi}"]`); if (!from) return;
          const f = box(from), mid = f.r + (t.l - f.r) / 2;
          d += `<path class="${R[r - 1][fi].winner ? "on" : ""}" d="M${f.r} ${f.y}H${mid}V${t.y}H${t.l}"/>`;
        });
      });
    }
    svg.innerHTML = d;
  }

  /* ---------- break screen, announcements, countdowns (ticks every second) ---------- */
  function startDate() {
    if (!data || !data.startAt) return null;
    const d = new Date(data.startAt);
    return isNaN(d) || d.getTime() < Date.now() - 60000 ? null : d;
  }
  function clockText(ms) {
    const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function paintOverlays() {
    if (!data) return;
    const brkOn = data.status === "break";
    $("#brk").classList.toggle("is-on", brkOn);
    if (brkOn) {
      const b = data.breakInfo || {}, until = b.until ? new Date(b.until) : null;
      $("#brkM").textContent = b.message || "";
      if (until) {
        const left = until - Date.now();
        $("#brkT").textContent = clockText(left);
        $("#brkU").textContent = left > 0 ? `გაგრძელება ${fmt.format(until)}-ზე` : "მალე გავაგრძელებთ";
      } else {
        $("#brkT").textContent = "მალე გავაგრძელებთ";
        $("#brkU").textContent = b.since ? `შესვენება დაიწყო ${fmt.format(new Date(b.since))}-ზე` : "";
      }
      $("#brkT").classList.toggle("is-text", !until);
    }
    const a = brkOn ? null : DT.activeAnnounce(data);
    const ann = $("#ann");
    ann.classList.toggle("is-on", !!a);
    ann.classList.toggle("is-call", !!(a && a.kind === "call"));
    if (stage.classList.contains("has-ann") !== !!a) {
      stage.classList.toggle("has-ann", !!a);
      if (mode === "bracket") renderBoard(); // bracket makes room for the strip, then takes it back
    }
    if (a) { $("#annK").textContent = a.kind === "call" ? "გამოძახება" : "განცხადება"; $("#annV").textContent = a.text; }
    $$(".cd[data-at]").forEach(el => {
      const at = new Date(el.dataset.at), left = at - Date.now();
      if (el.dataset.kind === "big") el.textContent = left > 0 ? clockText(left) : "";
      else el.innerHTML = left > 0 ? `დაწყება ${fmt.format(at)}-ზე · <b>${clockText(left)}</b>` : "";
    });
  }
  setInterval(paintOverlays, 1000);

  /* ---------- what changed since the last save ---------- */
  function winnersMap() {
    const m = {};
    allMatches().forEach(x => { if (x.mt.winner) m[x.mt.id] = x.mt.winner; });
    return m;
  }
  function celebrate() {
    const now = winnersMap(), fresh = [];
    if (prevWinners) Object.keys(now).forEach(id => { if (prevWinners[id] !== now[id]) fresh.push(id); });
    prevWinners = now;
    fresh.forEach(id => { const el = main.querySelector(`.m[data-id="${id}"]`); if (el) el.classList.add("just-won"); });
    const br = data.bracket;
    const moves = fresh.filter(id => br && +id.match(/^r(\d+)/)[1] < br.rounds.length - 1);
    if (moves.length > 3) banner("განახლება", `${moves.length} ახალი შედეგი`);
    else moves.forEach((id, k) => {
      const r = +id.match(/^r(\d+)/)[1];
      setTimeout(() => banner("გადის · " + DT.roundName(br.rounds[r + 1].length, r + 1), `${dot(now[id])}${esc(name(now[id]))}`, true), k * 4200);
    });
    const champ = DT.champion(data);
    if (prevChamp !== undefined && champ && champ !== prevChamp) showChampion(champ);
    prevChamp = champ;
  }

  let bannerT;
  function banner(kicker, value, isHtml) {
    $("#toastK").textContent = kicker;
    if (isHtml) $("#toastV").innerHTML = value; else $("#toastV").textContent = value;
    const el = $("#toast");
    el.classList.add("is-on");
    clearTimeout(bannerT); bannerT = setTimeout(() => el.classList.remove("is-on"), 3600);
  }

  /* ---------- champion moment ---------- */
  let champRaf = 0;
  function showChampion(id) {
    $("#champName").textContent = name(id);
    $("#champSub").textContent = data.title || "";
    $("#champ").classList.add("is-on");
    rainBalls();
    setTimeout(() => { $("#champ").classList.remove("is-on"); cancelAnimationFrame(champRaf); }, 16000);
  }
  function rainBalls() {
    if (!window.Billiards) return;
    const cv = $("#champBalls"), ctx = cv.getContext("2d");
    const W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight;
    const balls = [];
    for (let i = 0; i < 40; i++) {
      const b = Billiards.makeBall((i % 15) + 1, Math.random() * W, -Math.random() * H * 1.2 - 40, 20 + Math.random() * 14);
      b.vx = (Math.random() - .5) * 120; b.vy = 100 + Math.random() * 200;
      balls.push(b);
    }
    let last = performance.now();
    cancelAnimationFrame(champRaf);
    (function step(now) {
      const dt = Math.min(.033, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H);
      balls.forEach(b => {
        b.vy += 900 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y > H - b.r) { b.y = H - b.r; b.vy *= -.55; b.vx *= .9; }
        if (b.x < b.r || b.x > W - b.r) b.vx *= -1;
        Billiards.drawBall(ctx, b, { lightX: W / 2, lightY: H * .15 });
      });
      champRaf = requestAnimationFrame(step);
    })(last);
  }

  /* ---------- live connection ---------- */
  let version = -1, es = null, lastMsg = Date.now();
  function accept(st, isUpdate) {
    if (!st || typeof st.version !== "number" || st.version === version) return;
    version = st.version;
    data = Object.assign(DT.emptyData(), st.data || {});
    if (!Array.isArray(data.players)) data.players = [];
    if (data.bracket) DT.settle(data.bracket, DT.outSet(data));
    DT.schedule(data, false);
    render(isUpdate);
    celebrate();
  }
  function connect() {
    try { es && es.close(); } catch (e) {}
    es = new EventSource(DT.API + "/api/stream");
    es.addEventListener("state", e => { lastMsg = Date.now(); $("#conn").classList.remove("is-down"); try { accept(JSON.parse(e.data), version >= 0); } catch (err) {} });
    es.onopen = () => { lastMsg = Date.now(); $("#conn").classList.remove("is-down"); };
    es.onerror = () => { $("#conn").classList.add("is-down"); };
  }
  connect();
  // safety net: if the stream goes quiet, fetch directly and reconnect
  setInterval(() => {
    if (Date.now() - lastMsg > 60000) {
      fetch(DT.API + "/api/state", { cache: "no-store" }).then(r => r.json()).then(st => { lastMsg = Date.now(); accept(st, true); $("#conn").classList.remove("is-down"); }).catch(() => $("#conn").classList.add("is-down"));
      connect();
    }
  }, 20000);
  // keeps the free server awake while the TV is on
  setInterval(() => { fetch(DT.API + "/api/health", { cache: "no-store" }).catch(() => {}); }, 4 * 60 * 1000);

  /* ---------- TV comfort: hide the cursor, double click for fullscreen ---------- */
  let idleT;
  addEventListener("mousemove", () => { document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 2500); });
  const full = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); };
  addEventListener("dblclick", full);
  addEventListener("keydown", e => { if (e.key === "f" || e.key === "F") full(); });
})();
