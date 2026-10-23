/* DERBY tournament: live TV display */
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const COLORS = ["#f4c22b", "#1f4fbf", "#d8262e", "#5b2a91", "#f2741c", "#11804a", "#7c1e26", "#141519"];
  const stage = $("#stage"), main = $("#tvMain");
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
  function num(id) { const i = players().findIndex(p => p.id === id); return i < 0 ? 0 : i + 1; }
  function ball(id, big) {
    const n = num(id); if (!n) return `<span class="ball" style="--c:#2a2c33"></span>`;
    const c = COLORS[(n - 1) % 8], stripe = ((n - 1) % 16) >= 8;
    return `<span class="ball${stripe ? " ball--stripe" : ""}" style="--c:${c}">${n}</span>`;
  }
  function name(id) { const p = byId(id); return p ? p.name : ""; }
  function scores(mt) {
    const m = String(mt.score || "").match(/(\d+)\s*[-:/ ]\s*(\d+)/);
    return m ? [m[1], m[2]] : ["", ""];
  }

  /* ---------- clock ---------- */
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function tickClock() { $("#tvClock").textContent = fmt.format(new Date()); }
  tickClock(); setInterval(tickClock, 5000);

  /* ---------- render ---------- */
  function render(isUpdate) {
    $("#tvTitle").textContent = data.title || "DERBY";
    $("#tvSub").textContent = data.subtitle || "";
    document.title = `DERBY · ${data.title || "ტურნირი"} LIVE`;

    const st = DT.stats(data), br = data.bracket;
    const want = data.display === "players" ? "players" : (data.display === "bracket" && br ? "bracket" : (br ? "bracket" : (players().length ? "players" : "wait")));
    if (want === "players") renderWall(isUpdate && mode === "players");
    else if (want === "bracket") renderBracket(st);
    else renderWait();
    mode = want;

    $("#tvCount").innerHTML = br
      ? `<b>${st.players}</b> მოთამაშე · <b>${st.done}</b>/${st.total} მატჩი`
      : `<b>${st.players}</b> მოთამაშე`;
    renderTicker();
  }

  function renderWait() {
    main.innerHTML = `<div class="tv-wait"><img src="../assets/img/crest.png" alt=""><p>ტურნირი მალე დაიწყება</p><small>რეგისტრაცია მიმდინარეობს</small></div>`;
  }

  function renderWall(keep) {
    const list = players(), n = list.length;
    const cols = n <= 9 ? 3 : n <= 20 ? 4 : n <= 30 ? 5 : n <= 42 ? 6 : 8;
    const rows = Math.max(1, Math.ceil(n / cols));
    const ph = Math.max(52, Math.min(112, (640 - (rows - 1) * 18) / rows));
    main.innerHTML = `
      <section class="wall">
        <div class="wall__head">
          <h2>რეგისტრირებული<br><em>მოთამაშეები</em></h2>
          <div class="wall__count"><b>${n}</b><span>მოთამაშე</span></div>
        </div>
        <div class="wall__grid" style="--cols:${cols};--ph:${ph}px">
          ${list.map((p, i) => `<div class="pcard" style="--i:${keep ? 0 : i}">${ball(p.id)}<span>${esc(p.name)}</span></div>`).join("")}
        </div>
      </section>`;
  }

  function renderBracket(st) {
    const br = data.bracket, R = br.rounds, U = R[0].length;
    const slotsH = 812 - 64; // main height minus round heading
    const unit = slotsH / U;
    const champ = DT.champion(data);
    let html = `<section class="bracket" id="bracket">`;
    R.forEach((row, r) => {
      const span = 2 ** r, real = row.filter(m => !DT.isBye(m));
      const done = real.filter(m => m.winner).length;
      const size = unit * span;
      const kind = size >= 112 ? "" : size >= 66 ? " is-compact" : " is-mini";
      html += `<div class="round${st.round === r ? " is-current" : ""}">
        <div class="round__head"><b>${DT.roundName(row.length)}</b><span>${done}/${real.length}</span></div>
        <div class="round__slots" style="--units:${U}">`;
      row.forEach((mt, i) => {
        if (DT.isBye(mt)) return;
        const final = r === R.length - 1;
        // first round: a match surrounded by byes has room for the roomier two-line card
        let k = kind;
        if (kind === " is-mini" && r === 0 && (i === 0 || DT.isBye(row[i - 1])) && (i === row.length - 1 || DT.isBye(row[i + 1]))) k = " is-compact";
        const [sa, sb] = scores(mt);
        const side = (id, s) => {
          if (!id) return `<div class="pl is-tbd"><span class="ball"></span><span class="pl__name">ელოდება</span><b class="pl__score"></b></div>`;
          const cls = mt.winner ? (mt.winner === id ? " is-win" : " is-lose") : "";
          return `<div class="pl${cls}">${ball(id)}<span class="pl__name">${esc(name(id))}</span><b class="pl__score">${esc(s)}</b></div>`;
        };
        const vs = mt.winner && (sa || sb) ? `${esc(sa)}:${esc(sb)}` : "vs";
        html += `<div class="mt${k}${mt.live ? " is-live" : ""}${mt.winner ? " is-done" : ""}${final ? " is-final" : ""}" data-id="${mt.id}" data-r="${r}" data-i="${i}"
          style="grid-row:${i * span + 1} / span ${span}">
          <div class="mt__tag"><span>${mt.table ? "მაგიდა " + esc(mt.table) : ""}</span><span class="lv">LIVE</span></div>
          ${side(mt.a, sa)}<span class="mt__vs">${vs}</span>${side(mt.b, sb)}
        </div>`;
      });
      if (r === R.length - 1 && champ) html += `<div class="trophy" style="grid-row:${U} / span 1;align-self:end"><small>ჩემპიონი</small><b>${esc(name(champ))}</b></div>`;
      html += `</div></div>`;
    });
    html += `<svg class="links" id="links"></svg></section>`;
    main.innerHTML = html;
    requestAnimationFrame(drawLinks);
  }

  // elbow lines from each match to the one its winner goes to
  function drawLinks() {
    const wrap = $("#bracket"), svg = $("#links");
    if (!wrap || !svg || document.documentElement.classList.contains("portrait")) return;
    const base = wrap.getBoundingClientRect(), s = scale || 1;
    const R = data.bracket.rounds;
    let d = "";
    const box = el => { const r = el.getBoundingClientRect(); return { l: (r.left - base.left) / s, r: (r.right - base.left) / s, y: (r.top + r.height / 2 - base.top) / s }; };
    for (let r = 1; r < R.length; r++) {
      R[r].forEach((mt, i) => {
        const to = wrap.querySelector(`.mt[data-r="${r}"][data-i="${i}"]`); if (!to) return;
        const t = box(to);
        [i * 2, i * 2 + 1].forEach(fi => {
          const from = wrap.querySelector(`.mt[data-r="${r - 1}"][data-i="${fi}"]`); if (!from) return;
          const f = box(from), mid = f.r + (t.l - f.r) / 2;
          const on = R[r - 1][fi].winner ? "on" : "";
          d += `<path class="${on}" d="M${f.r} ${f.y}H${mid}V${t.y}H${t.l}"/>`;
        });
      });
    }
    svg.innerHTML = d;
  }

  function renderTicker() {
    const items = [];
    const br = data.bracket;
    if (br) {
      const all = [];
      br.rounds.forEach((row, r) => row.forEach(mt => { if (!DT.isBye(mt)) all.push({ mt, r, count: row.length }); }));
      all.filter(x => x.mt.live && !x.mt.winner).forEach(({ mt }) =>
        items.push(`<span class="t-live"><i>LIVE</i><b>${esc(name(mt.a))}</b> vs <b>${esc(name(mt.b))}</b>${mt.table ? " · მაგიდა " + esc(mt.table) : ""}</span>`));
      all.filter(x => DT.ready(x.mt) && !x.mt.winner && !x.mt.live).slice(0, 4).forEach(({ mt, count }) =>
        items.push(`<span class="t-next"><i>შემდეგი</i><b>${esc(name(mt.a))}</b> vs <b>${esc(name(mt.b))}</b> · ${DT.roundName(count)}</span>`));
      all.filter(x => x.mt.winner).sort((a, b) => (b.mt.doneAt || "").localeCompare(a.mt.doneAt || "")).slice(0, 6).forEach(({ mt }) => {
        const loser = mt.winner === mt.a ? mt.b : mt.a;
        items.push(`<span class="t-res"><i>შედეგი</i><b>${esc(name(mt.winner))}</b> მოიგო ${esc(name(loser))}${mt.score ? " · " + esc(mt.score) : ""}</span>`);
      });
    }
    if (!items.length) items.push(`<span><b>DERBY</b> · მარატ ნოზაძის 3, გლდანი · +995 568 03 05 05</span>`);
    const tr = $("#ticker");
    const html = items.join("");
    if (tr.dataset.html !== html) {
      tr.dataset.html = html;
      tr.innerHTML = html;
      tr.style.setProperty("--dur", Math.max(25, items.length * 9) + "s");
    }
  }

  /* ---------- what changed since the last save ---------- */
  function winnersMap() {
    const m = {}; const br = data && data.bracket;
    if (br) br.rounds.forEach(row => row.forEach(mt => { if (!DT.isBye(mt) && mt.winner) m[mt.id] = mt.winner; }));
    return m;
  }
  function celebrate() {
    const now = winnersMap(), fresh = [];
    if (prevWinners) Object.keys(now).forEach(id => { if (prevWinners[id] !== now[id]) fresh.push(id); });
    prevWinners = now;
    fresh.forEach(id => { const el = main.querySelector(`.mt[data-id="${id}"]`); if (el) el.classList.add("just-won"); });
    const br = data.bracket;
    const moves = fresh.filter(id => br && +id.match(/^r(\d+)/)[1] < br.rounds.length - 1);
    if (moves.length > 3) toast(null, `${moves.length} შედეგი განახლდა`);
    else moves.forEach((id, k) => {
      const r = +id.match(/^r(\d+)/)[1];
      setTimeout(() => toast(now[id], DT.roundName(br.rounds[r + 1].length)), k * 3200);
    });
    const champ = DT.champion(data);
    if (prevChamp !== undefined && champ && champ !== prevChamp) showChampion(champ);
    prevChamp = champ;
  }

  let toastT;
  function toast(id, next) {
    const el = $("#toast");
    el.innerHTML = id ? `${ball(id)}<span>${esc(name(id))} გადის: ${esc(next)}</span>` : `<span style="padding-left:12px">${esc(next)}</span>`;
    el.classList.add("is-on");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("is-on"), 3000);
  }

  /* ---------- champion moment ---------- */
  let champRaf = 0;
  function showChampion(id) {
    const el = $("#champ");
    $("#champName").textContent = name(id);
    $("#champSub").textContent = data.title || "";
    el.classList.add("is-on");
    rainBalls();
    setTimeout(() => { el.classList.remove("is-on"); cancelAnimationFrame(champRaf); }, 16000);
  }
  function rainBalls() {
    if (!window.Billiards) return;
    const cv = $("#champBalls"), ctx = cv.getContext("2d");
    const W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight;
    const balls = [];
    for (let i = 0; i < 46; i++) {
      const b = Billiards.makeBall((i % 15) + 1, Math.random() * W, -Math.random() * H * 1.2 - 40, 22 + Math.random() * 16);
      b.vx = (Math.random() - .5) * 120; b.vy = 100 + Math.random() * 200;
      balls.push(b);
    }
    let last = performance.now();
    (function step(now) {
      const dt = Math.min(.033, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H);
      balls.forEach(b => {
        b.vy += 900 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y > H - b.r) { b.y = H - b.r; b.vy *= -.55; b.vx *= .9; }
        if (b.x < b.r || b.x > W - b.r) b.vx *= -1;
        Billiards.drawBall(ctx, b, { lightX: W / 2, lightY: H * .2 });
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
