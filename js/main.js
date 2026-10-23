/* DERBY · site motion and logic */
(function () {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const I18N = window.DERBY_I18N;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const hasGsap = !!window.gsap;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  scrollTo(0, 0);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- language ---------- */
  const params = new URLSearchParams(location.search);
  let lang = params.get("lang") || store.get("derby-lang") || "ka";
  if (!I18N[lang]) lang = "ka";
  const t = k => (I18N[lang][k] != null ? I18N[lang][k] : I18N.ka[k]);

  function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function splitAll() {
    $$("[data-split] [data-i18n]").forEach(el => {
      const words = el.textContent.trim().split(/\s+/);
      el.innerHTML = words.map(w => `<span class="sw"><span>${esc(w)}</span></span>`).join(" ");
    });
  }

  function applyLang(l, first) {
    lang = l;
    document.documentElement.lang = l;
    document.title = t("meta.title");
    $$("[data-i18n]").forEach(el => { const v = t(el.dataset.i18n); if (typeof v === "string") el.textContent = v; });
    splitAll();
    buildMarquee();
    buildHours();
    tickClock();
    $$(".lang button").forEach(b => b.classList.toggle("is-on", b.dataset.lang === l));
    movePill();
    store.set("derby-lang", l);
    if (!first && hasGsap) requestAnimationFrame(() => ScrollTrigger.refresh());
  }
  function movePill() {
    const on = $(".lang button.is-on"), pill = $(".lang__pill");
    if (on && pill) pill.style.transform = `translateX(${on.offsetLeft - 4}px)`;
  }
  $$(".lang button").forEach(b => b.addEventListener("click", () => applyLang(b.dataset.lang)));
  addEventListener("resize", movePill);

  /* ---------- Tbilisi clock ---------- */
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tbilisi", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  function now() {
    const p = fmt.formatToParts(new Date()), g = k => (p.find(x => x.type === k) || {}).value;
    const h = (+g("hour")) % 24, m = +g("minute"), wd = WD.indexOf(g("weekday"));
    const open = h >= 12 || h < 3;
    return { h, m, wd, open, bday: h < 3 ? (wd + 6) % 7 : wd, evening: h >= 18 || h < 3 };
  }
  const pad = n => String(n).padStart(2, "0");

  function tickClock() {
    const n = now();
    $$("[data-status]").forEach(el => el.classList.toggle("is-closed", !n.open));
    $$("[data-status-main]").forEach(el => el.textContent = t(n.open ? "status.open" : "status.closed"));
    $$("[data-status-sub]").forEach(el => el.textContent = t(n.open ? "status.until" : "status.opens"));
    const dial = $(".dial"); if (dial) dial.classList.toggle("is-closed", !n.open);
    const dt = $("#dialTime"); if (dt) dt.textContent = `${pad(n.h)}:${pad(n.m)}`;
    const needle = $("#dialNeedle");
    if (needle) {
      const deg = (n.h + n.m / 60) / 24 * 360;
      needle.setAttribute("transform", `rotate(${deg} 200 200)`);
    }
    // pool: 10 until 18:00, 15 after
    const eve = n.open ? n.evening : false;
    const pp = $("[data-pool-price]"); if (pp && !pp.dataset.counting) pp.textContent = eve ? "15" : "10";
    $$(".tcard--pool .tariff li").forEach(li => li.classList.toggle("is-on", li.dataset.slot === (eve ? "eve" : "day")));
    $$("#hoursList li").forEach((li, i) => li.classList.toggle("is-today", i === n.bday));
  }
  setInterval(tickClock, 20000);

  function buildHours() {
    const ul = $("#hoursList"); if (!ul) return;
    const days = t("days"), b = now().bday;
    ul.innerHTML = days.map((d, i) => `<li class="${i === b ? "is-today" : ""}"><span class="hours__day"${i === b ? ` title="${esc(t("today"))}"` : ""}>${esc(d)}</span><span class="hours__time">12:00<i></i>03:00</span></li>`).join("");
  }

  /* ---------- dial ---------- */
  function polar(h, r) { const a = (h / 24) * Math.PI * 2 - Math.PI / 2; return [200 + Math.cos(a) * r, 200 + Math.sin(a) * r]; }
  function arcPath(h1, h2, r) {
    if (h2 <= h1) h2 += 24;
    const [x1, y1] = polar(h1, r), [x2, y2] = polar(h2, r), large = (h2 - h1) > 12 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  (function buildDial() {
    const sights = $("#dialSights"), nums = $("#dialNums"); if (!sights) return;
    let a = "", b = "";
    for (let h = 0; h < 24; h++) {
      const [x, y] = polar(h, 181), ang = h / 24 * 360;
      a += h % 3 === 0
        ? `<rect class="dial__sight" x="${x - 4}" y="${y - 4}" width="8" height="8" transform="rotate(${ang + 45} ${x} ${y})"/>`
        : `<circle class="dial__dot" cx="${x}" cy="${y}" r="1.8"/>`;
      if (h % 3 === 0) { const [tx, ty] = polar(h, 131); b += `<text class="dial__num" x="${tx}" y="${ty}">${h}</text>`; }
    }
    sights.innerHTML = a; nums.innerHTML = b;
    $("#arcClosed").setAttribute("d", arcPath(3, 12, 158));
    const day = $("#arcDay"), eve = $("#arcEve"), chase = $("#arcChase");
    day.setAttribute("d", arcPath(12, 18, 158)); eve.setAttribute("d", arcPath(18, 3, 158)); chase.setAttribute("d", arcPath(12, 3, 158));
    [day, eve, chase].forEach(el => el.setAttribute("pathLength", "1"));
    [day, eve].forEach(el => { el.style.strokeDasharray = "1"; el.style.strokeDashoffset = reduced || !hasGsap ? "0" : "1"; });
    if (reduced || !hasGsap) $(".dial").classList.add("is-lit");
  })();

  /* ---------- marquee ---------- */
  const BALLC = ["#f4c22b", "#1f4fbf", "#d8262e", "#5b2a91", "#f2741c", "#11804a"];
  function buildMarquee() {
    const tr = $("#marquee"); if (!tr) return;
    const words = t("marquee");
    const item = `<div class="marquee__item">${words.map((w, i) => `<span>${esc(w)}</span><i class="mball" style="--c:${BALLC[i % BALLC.length]}"></i>`).join("")}</div>`;
    tr.innerHTML = item + item + item;
  }

  /* ---------- initial ---------- */
  applyLang(lang, true);
  $("#year").textContent = new Date().getFullYear();

  /* ---------- video sound ---------- */
  // Browsers block sound until the visitor interacts with the page. We ask for sound first (some
  // browsers allow it for returning visitors); if refused, the video plays muted and the very first
  // tap, click or key press turns sound on. It fades out as you scroll past the video, and the
  // speaker buttons let visitors switch it on or off (their choice is remembered).
  const video = $("#heroVideo"), soundBtns = $$("[data-sound]");
  const snd = { wanted: store.get("derby-sound") !== "off", unlocked: false, level: 1 };
  const activated = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
  function paintSound() {
    const on = snd.wanted && snd.unlocked;
    soundBtns.forEach(b => {
      b.classList.toggle("is-on", on);
      b.classList.toggle("is-playing", on && !video.muted && !video.paused);
      b.classList.toggle("is-waiting", snd.wanted && !snd.unlocked);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  function applySound() {
    const audible = snd.wanted && snd.unlocked && snd.level > .02;
    video.muted = !audible;
    try { video.volume = Math.max(0, Math.min(1, snd.level)); } catch (e) {}
    if (snd.level > .02 && video.paused) video.play().catch(() => {});
    paintSound();
  }
  function unlockSound(want) {
    if (want != null) { snd.wanted = want; store.set("derby-sound", want ? "on" : "off"); }
    if (!activated()) { paintSound(); return; }
    snd.unlocked = true;
    applySound();
  }
  function tryAutoSound() {
    if (!snd.wanted || snd.unlocked) { applySound(); return; }
    video.muted = false;
    const p = video.play();
    const fallback = () => { video.muted = true; video.play().catch(() => {}); paintSound(); };
    if (p && p.then) p.then(() => { if (video.paused) fallback(); else { snd.unlocked = true; applySound(); } }).catch(fallback);
    else fallback();
  }
  ["play", "pause", "volumechange"].forEach(k => video.addEventListener(k, paintSound));
  soundBtns.forEach(b => b.addEventListener("click", () => unlockSound(!(snd.wanted && snd.unlocked))));
  const GESTURES = ["pointerup", "touchend", "click", "keydown"];
  const firstTap = e => {
    if (e.target.closest && e.target.closest("[data-sound]")) return;
    if (!activated()) return;
    GESTURES.forEach(k => removeEventListener(k, firstTap, true));
    if (snd.wanted && !snd.unlocked) unlockSound();
  };
  GESTURES.forEach(k => addEventListener(k, firstTap, true));

  /* ---------- menu ---------- */
  const burger = $(".burger");
  function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    burger.setAttribute("aria-expanded", String(open));
    $("#menu").setAttribute("aria-hidden", String(!open));
    if (lenis) open ? lenis.stop() : lenis.start();
    if (open && hasGsap) gsap.fromTo("#menu .menu__links a", { yPercent: 120, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: .07, duration: .9, ease: "expo.out", delay: .2 });
  }
  burger.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);
  if (hasGsap && window.Lenis && !reduced) {
    lenis = new Lenis({ lerp: .09, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(time => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  $$('a[href^="#"]').forEach(a => a.addEventListener("click", e => {
    const id = a.getAttribute("href"); const el = id === "#top" ? document.body : $(id);
    if (!el) return;
    e.preventDefault();
    if (document.body.classList.contains("menu-open")) setMenu(false);
    let target = el;
    // the hero is pinned; jump past the reveal so the content shows
    if (lenis) lenis.scrollTo(id === "#top" ? 0 : target, { duration: 1.6, easing: x => 1 - Math.pow(1 - x, 4) });
    else (id === "#top" ? scrollTo({ top: 0, behavior: "smooth" }) : target.scrollIntoView({ behavior: "smooth" }));
  }));

  /* ---------- game ---------- */
  const gameWrap = $("#pooltable"), canvas = $("#game");
  let game = null;
  function sizeTable() {
    const portrait = innerWidth < 760 && innerHeight > innerWidth;
    gameWrap.classList.toggle("is-portrait", portrait);
  }
  sizeTable();
  function initGame() {
    if (!window.Billiards) return;
    const toastEl = $("#toast"), win = $("#win");
    game = new Billiards.Game(canvas, {
      update(g) { $("#potted").textContent = g.potted; $("#shots").textContent = g.shots; },
      toast(kind) {
        toastEl.textContent = t(kind === "scratch" ? "play.scratch" : "play.nice");
        if (!hasGsap) return;
        gsap.killTweensOf(toastEl);
        gsap.timeline().fromTo(toastEl, { opacity: 0, y: 24, scale: .85 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: "back.out(2)" })
          .to(toastEl, { opacity: 0, y: -16, duration: .4, delay: .5 });
      },
      win() { win.classList.add("is-on"); }
    });
    const io = new IntersectionObserver(es => es.forEach(e => game.visible = e.isIntersecting), { rootMargin: "100px" });
    io.observe(canvas);
    let rt;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (game.layout()) game.reset(); }, 60); }).observe(gameWrap);
    addEventListener("resize", sizeTable);
    const again = () => { win.classList.remove("is-on"); game.reset(); };
    $("#rerack").addEventListener("click", again);
    $("#again").addEventListener("click", again);
    const sfx = $("#sfx");
    sfx.addEventListener("click", () => { Billiards.Sfx.on = !Billiards.Sfx.on; sfx.setAttribute("aria-pressed", String(Billiards.Sfx.on)); Billiards.Sfx.unlock(); });
  }

  /* ---------- cursor ---------- */
  function initCursor() {
    if (!finePointer || reduced) return;
    document.documentElement.classList.add("has-cursor");
    const c = $(".cursor"), ring = $(".cursor__ring"), ball = $(".cursor__ball");
    let mx = -100, my = -100, rx = mx, ry = my, seen = false;
    c.classList.add("is-hidden");
    addEventListener("pointermove", e => {
      mx = e.clientX; my = e.clientY; ball.style.translate = `${mx}px ${my}px`;
      if (!seen) { seen = true; rx = mx; ry = my; c.classList.remove("is-hidden"); }
    }, { passive: true });
    (function loop() { rx += (mx - rx) * .18; ry += (my - ry) * .18; ring.style.translate = `${rx}px ${ry}px`; requestAnimationFrame(loop); })();
    document.addEventListener("pointerover", e => {
      const el = e.target;
      c.classList.toggle("is-hidden", !!el.closest("canvas, iframe"));
      c.classList.toggle("is-link", !!el.closest("a, button"));
    });
    document.addEventListener("pointerleave", () => c.classList.add("is-hidden"));
    document.addEventListener("pointerenter", () => c.classList.remove("is-hidden"));
  }

  /* ---------- magnetic ---------- */
  function initMagnetic() {
    if (!finePointer || reduced || !hasGsap) return;
    $$("[data-magnetic]").forEach(el => {
      const xTo = gsap.quickTo(el, "x", { duration: .6, ease: "power3.out" }), yTo = gsap.quickTo(el, "y", { duration: .6, ease: "power3.out" });
      el.addEventListener("pointermove", e => { const r = el.getBoundingClientRect(); xTo((e.clientX - r.left - r.width / 2) * .3); yTo((e.clientY - r.top - r.height / 2) * .4); });
      el.addEventListener("pointerleave", () => { gsap.to(el, { x: 0, y: 0, duration: 1, ease: "elastic.out(1, .4)" }); });
    });
  }

  /* ---------- table cards ---------- */
  function initCards() {
    $$(".tcard").forEach(card => {
      const felt = $(".tcard__felt", card), ball = $(".cball", card);
      const sheen = document.createElement("div"); sheen.className = "tcard__sheen"; card.appendChild(sheen);
      if (finePointer && !reduced && hasGsap) {
        const rX = gsap.quickTo(card, "rotationX", { duration: .8, ease: "power3.out" }), rY = gsap.quickTo(card, "rotationY", { duration: .8, ease: "power3.out" });
        card.addEventListener("pointermove", e => {
          const r = card.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          rY((px - .5) * 12); rX(-(py - .5) * 10);
          card.style.setProperty("--mx", (px * 100).toFixed(1) + "%"); card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
        });
        card.addEventListener("pointerleave", () => { rX(0); rY(0); card.style.setProperty("--mx", "50%"); card.style.setProperty("--my", "30%"); });
        card.addEventListener("pointerenter", () => rollBall(card));
      }
    });
    initTableSwipe();
  }

  // the card's ball rolls into a corner pocket, then respots
  function rollBall(card) {
    if (reduced || !hasGsap || card.dataset.rolling) return;
    card.dataset.rolling = "1";
    const felt = $(".tcard__felt", card), ball = $(".cball", card);
    const fr = felt.getBoundingClientRect(), br = ball.getBoundingClientRect();
    const bx = br.left + br.width / 2 - fr.left, by = br.top + br.height / 2 - fr.top;
    const right = Math.random() > .5;
    const tx = (right ? fr.width + 6 : -6) - bx, ty = 8 - by;
    const turns = Math.hypot(tx, ty) / (Math.PI * br.width) * 360;
    gsap.timeline({ onComplete: () => delete card.dataset.rolling })
      .to(ball, { x: tx * .9, y: ty * .9, rotation: right ? turns : -turns, duration: .75, ease: "power2.in" })
      .to(ball, { x: tx, y: ty, scale: .35, opacity: 0, duration: .22, ease: "power1.in" })
      .add(() => buzz(14))
      .set(ball, { x: 0, y: 0, rotation: 0 })
      .to(ball, { scale: 1, opacity: 1, duration: .6, ease: "back.out(2.2)", delay: .35 });
  }

  function buzz(ms) { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) {} }

  // phones: swipe between the three tables, the one in focus lights up
  function initTableSwipe() {
    const wrap = $(".tables"), cards = $$(".tcard"), dots = $$(".tables__dots i");
    const mq = matchMedia("(max-width: 900px)");
    let current = -1;
    function update() {
      if (!mq.matches) { cards.forEach(c => c.classList.add("is-active")); return; }
      const mid = wrap.scrollLeft + wrap.clientWidth / 2;
      let best = 0, bd = Infinity;
      cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
      if (best === current) return;
      current = best;
      cards.forEach((c, i) => c.classList.toggle("is-active", i === best));
      dots.forEach((d, i) => d.classList.toggle("is-on", i === best));
      buzz(6);
      setTimeout(() => rollBall(cards[best]), 250);
    }
    wrap.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
    mq.addEventListener("change", () => { current = -1; update(); });
    cards[0].classList.add("is-active");
    if (!mq.matches) cards.forEach(c => c.classList.add("is-active"));
    else current = 0;
  }

  /* ---------- nav state ---------- */
  function initNav() {
    const nav = $("#nav"), dock = $("#dock"), foot = $(".foot");
    let lastY = 0;
    const onScroll = y => {
      const heroEnd = innerHeight * 1.4;
      nav.classList.toggle("is-solid", y > heroEnd);
      dock.classList.toggle("is-on", y > heroEnd && y + innerHeight < foot.getBoundingClientRect().top + y + 160);
      if (y > heroEnd && y > lastY + 4) nav.classList.add("is-hidden");
      else if (y < lastY - 4 || y < heroEnd) nav.classList.remove("is-hidden");
      lastY = y;
    };
    if (lenis) lenis.on("scroll", () => onScroll(scrollY));
    addEventListener("scroll", () => onScroll(scrollY), { passive: true });
    if (!hasGsap) return;
    ["games", "space", "play", "visit"].forEach(id => {
      ScrollTrigger.create({
        trigger: "#" + id, start: "top 50%", end: "bottom 50%",
        onToggle: s => $$(`.nav__links a[href="#${id}"]`).forEach(a => a.classList.toggle("is-active", s.isActive))
      });
    });
  }

  /* ---------- hero ---------- */
  // DERBY is drawn on one canvas with the video clipped inside the letters.
  // A giant scaled CSS layer broke on phones, so the zoom happens in the drawing instead.
  const HC = { zoom: 1, enter: 1 };
  let heroDraw = null, heroST = null;
  function setupHeroCanvas() {
    const cv = $("#heroCanvas"), ctx = cv.getContext("2d"), media = $(".hero__media"), poster = new Image();
    poster.src = video.getAttribute("poster");
    const FONT = fs => `900 ${fs}px Unbounded, "Noto Sans Georgian", sans-serif`;
    let W = 0, H = 0, dpr = 1, L = null;
    function measure() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const stacked = W < 700 && H > W;
      const fs = stacked ? Math.min(H * .146, W * .44) : Math.min(W * .205, H * .42);
      ctx.font = FONT(fs);
      const letters = ["D", "E", "R", "B", "Y"];
      const asc = ctx.measureText("D").actualBoundingBoxAscent || fs * .72;
      const items = [];
      let bottom;
      if (stacked) {
        const lh = fs * .8, top = (H - lh * 5) / 2 + 10;
        letters.forEach((c, i) => { const w = ctx.measureText(c).width; items.push({ c, x: (W - w) / 2, y: top + lh * i + lh / 2 + asc / 2 }); });
        bottom = top + lh * 5;
      } else {
        const ls = -.03 * fs, ws = letters.map(c => ctx.measureText(c).width);
        let x = (W - (ws.reduce((a, b) => a + b, 0) + ls * 4)) / 2;
        letters.forEach((c, i) => { items.push({ c, x, y: H / 2 + asc / 2 }); x += ws[i] + ls; });
        bottom = H / 2 + asc / 2;
      }
      // middle of the D's stem, so the zoom flies into solid letter, not the hole
      const tc = document.createElement("canvas"), tw = Math.ceil(ctx.measureText("D").width) + 4, th = Math.ceil(asc) + 4;
      tc.width = tw; tc.height = th;
      const tx = tc.getContext("2d"); tx.font = FONT(fs); tx.fillText("D", 0, th - 2);
      const row = tx.getImageData(0, Math.floor(th / 2), tw, 1).data;
      let a = -1, b = -1;
      for (let i = 0; i < tw; i++) { if (row[i * 4 + 3] > 128) { if (a < 0) a = i; b = i; } else if (a >= 0) break; }
      const stem = a < 0 ? tw * .14 : (a + b) / 2;
      L = { fs, items, ox: items[0].x + stem, oy: items[0].y - asc / 2 };
      $(".hero").style.setProperty("--tag-top", Math.round(bottom + (stacked ? 16 : 34)) + "px");
    }
    function cover(src, sw, sh, k) {
      const sc = Math.max(W / sw, H / sh) * k, dw = sw * sc, dh = sh * sc;
      ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    function draw() {
      if (!L || !W || (heroST && heroST.progress > .74)) return;
      const sc = HC.zoom * HC.enter;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(L.ox, L.oy); ctx.scale(sc, sc); ctx.translate(-L.ox, -L.oy);
      ctx.font = FONT(L.fs); ctx.fillStyle = "#fff";
      L.items.forEach(it => ctx.fillText(it.c, it.x, it.y));
      ctx.restore();
      ctx.globalCompositeOperation = "source-in";
      const k = gsap.getProperty(media, "scale") || 1;
      if (video.readyState >= 2 && video.videoWidth) cover(video, video.videoWidth, video.videoHeight, k);
      else if (poster.complete && poster.naturalWidth) cover(poster, poster.naturalWidth, poster.naturalHeight, k);
      else { ctx.fillStyle = "#26365f"; ctx.fillRect(0, 0, W, H); }
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#05080f"; ctx.fillRect(0, 0, W, H);
    }
    measure();
    addEventListener("resize", () => { measure(); draw(); });
    gsap.ticker.add(draw);
    return { measure, zoomTo: () => (L ? Math.hypot(W, H) * 2.6 / (L.fs * .17) : 40) };
  }
  function initHero() {
    if (reduced) {
      gsap.set("#heroCanvas, .hero__pre", { autoAlpha: 0 });
      gsap.set(".hero__shade", { opacity: 1 });
      gsap.set(".hero__content, .hero__hud", { visibility: "visible" });
      return;
    }
    heroDraw = setupHeroCanvas();
    ScrollTrigger.addEventListener("refreshInit", () => heroDraw.measure());
    const tl = gsap.timeline({ defaults: { ease: "none" } });
    tl.to(".hero__pre", { autoAlpha: 0, duration: .12 }, 0)
      .fromTo(HC, { zoom: 1 }, { zoom: () => heroDraw.zoomTo(), ease: "power3.in", duration: .7 }, 0)
      .fromTo(".hero__media", { scale: 1.22 }, { scale: 1, duration: .8 }, 0)
      .to("#heroCanvas", { autoAlpha: 0, duration: .04 }, .68)
      .to(".hero__shade", { opacity: 1, duration: .18 }, .64)
      .set(".hero__content", { visibility: "visible" }, .7)
      .fromTo(".hero__title .line > *", { yPercent: 115 }, { yPercent: 0, stagger: .05, duration: .16, ease: "power3.out" }, .72)
      .fromTo([".hero__sub", ".hero__ctas"], { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, stagger: .04, duration: .14, ease: "power2.out" }, .76)
      .fromTo(".hero__hud", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: .12 }, .82)
      .to({}, { duration: .1 });
    heroST = ScrollTrigger.create({
      trigger: ".hero", start: "top top", end: () => "+=" + innerHeight * 1.6,
      pin: true, scrub: 1, animation: tl, invalidateOnRefresh: true, anticipatePin: 1
    });
    // sound fades out as the next section comes up, and the video rests once it is gone
    ScrollTrigger.create({
      trigger: ".games", start: "top bottom", end: "top 25%",
      onUpdate: st => {
        snd.level = 1 - st.progress; applySound();
        if (st.progress >= 1) video.pause(); else if (video.paused) video.play().catch(() => {});
      }
    });
  }
  function heroEnter() {
    if (reduced) return;
    gsap.fromTo(HC, { enter: 1.15 }, { enter: 1, duration: 2, ease: "expo.out" });
    gsap.from(".hero__tag, .hero__cue", { opacity: 0, y: 24, stagger: .12, duration: 1.2, ease: "expo.out", delay: .3 });
  }

  /* ---------- reveals ---------- */
  function initReveals() {
    if (reduced) return;
    // headings: words rise out of the cloth
    $$(".sec-head, .space__intro").forEach(head => {
      head.classList.add("is-pending");
      const run = () => {
        head.classList.remove("is-pending");
        const tl = gsap.timeline();
        tl.fromTo($$(".sw > span", head), { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, stagger: .06, duration: 1.2, ease: "expo.out" })
          .fromTo($$(".kicker, .lead, .space__count", head), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, stagger: .08, duration: 1, ease: "expo.out" }, .1);
      };
      const isSpaceDesktop = head.classList.contains("space__intro") && innerWidth > 900;
      ScrollTrigger.create({ trigger: isSpaceDesktop ? ".space" : head, start: isSpaceDesktop ? "top 60%" : "top 82%", once: true, onEnter: run });
    });

    // table cards slide in like balls on cloth
    const cardsMM = gsap.matchMedia();
    cardsMM.add("(min-width: 901px)", () => {
      gsap.set(".tcard", { autoAlpha: 0, y: 140, rotationX: 28, transformOrigin: "50% 100%" });
      ScrollTrigger.batch(".tcard", {
        start: "top 88%", once: true,
        onEnter: els => gsap.to(els, { autoAlpha: 1, y: 0, rotationX: 0, stagger: .14, duration: 1.4, ease: "expo.out", clearProps: "transform", onComplete() { this.targets().forEach(el => gsap.set(el, { rotationX: 0, rotationY: 0 })); } })
      });
    });
    // phones: the row of tables slides in from the right, then nudges to hint the swipe
    cardsMM.add("(max-width: 900px)", () => {
      gsap.fromTo(".tables", { x: 120, autoAlpha: 0 }, {
        x: 0, autoAlpha: 1, duration: 1.3, ease: "expo.out",
        scrollTrigger: { trigger: ".tables", start: "top 85%", once: true },
        onComplete() {
          const w = $(".tables");
          if (w.scrollLeft < 4) { w.scrollTo({ left: 60, behavior: "smooth" }); setTimeout(() => w.scrollTo({ left: 0, behavior: "smooth" }), 450); }
        }
      });
    });
    // pool price counts up
    const pp = $("[data-pool-price]");
    ScrollTrigger.create({
      trigger: ".tables", start: "top 75%", once: true, onEnter: () => {
        $$(".price__num").forEach(el => {
          const end = +el.textContent, o = { v: 0 };
          el.dataset.counting = "1";
          gsap.to(o, { v: end, duration: 1.6, ease: "power3.out", delay: .4, onUpdate: () => el.textContent = Math.round(o.v), onComplete: () => { delete el.dataset.counting; tickClock(); } });
        });
      }
    });

    // play table rises
    gsap.fromTo(".pooltable", { autoAlpha: 0, y: 100, scale: .94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: ".pooltable", start: "top 88%", once: true } });
    gsap.fromTo(".hud > *", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, stagger: .08, duration: 1, ease: "expo.out", scrollTrigger: { trigger: ".hud", start: "top 90%", once: true } });

    // visit cards
    ScrollTrigger.batch(".visit .card", {
      start: "top 88%", once: true,
      onEnter: els => gsap.fromTo(els, { autoAlpha: 0, y: 80 }, { autoAlpha: 1, y: 0, stagger: .12, duration: 1.3, ease: "expo.out" })
    });
    gsap.set(".visit .card", { autoAlpha: 0 });
    ScrollTrigger.create({
      trigger: ".dial", start: "top 75%", once: true, onEnter: () => {
        gsap.to("#arcDay", { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut" });
        gsap.to("#arcEve", { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut", delay: 1.15, onComplete: () => $(".dial").classList.add("is-lit") });
        const n = now(), deg = (n.h + n.m / 60) / 24 * 360, o = { d: 0 };
        gsap.to(o, { d: deg, duration: 2.4, ease: "expo.inOut", onUpdate: () => $("#dialNeedle").setAttribute("transform", `rotate(${o.d} 200 200)`) });
        $$(".hours__list li").forEach((li, i) => gsap.fromTo(li, { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: .9, delay: .3 + i * .06, ease: "expo.out" }));
      }
    });

    // footer letters
    gsap.fromTo(".foot__word span", { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: .07, duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: ".foot__word", start: "top 95%", once: true } });
    gsap.fromTo(".foot__top > *", { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, stagger: .1, duration: 1, ease: "expo.out", scrollTrigger: { trigger: ".foot", start: "top 85%", once: true } });

    // marquee: drifts on its own, pushed by scroll speed
    const tr = $("#marquee"); let x = 0, boost = 0;
    gsap.ticker.add((time, dt) => {
      const item = tr.firstElementChild; if (!item) return;
      const w = item.offsetWidth;
      const v = lenis ? lenis.velocity : 0;
      boost += (v * .6 - boost) * .1;
      x -= (dt / 16.67) * (1.1 + Math.abs(boost)) * (boost < -0.5 ? -1 : 1);
      if (x <= -w) x += w; if (x > 0) x -= w;
      tr.style.transform = `translate3d(${x}px,0,0) skewX(${Math.max(-8, Math.min(8, -boost * .5))}deg)`;
    });
  }

  /* ---------- the space ---------- */
  function initSpace() {
    if (reduced) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 901px)", () => {
      const track = $(".space__track");
      const dist = () => Math.max(0, track.scrollWidth - innerWidth);
      const tween = gsap.to(track, {
        x: () => -dist(), ease: "none",
        scrollTrigger: {
          trigger: ".space", start: "top top", end: () => "+=" + dist(), pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
          onUpdate: s => { const i = Math.min(6, 1 + Math.floor(s.progress * 6)); $("#spaceNow").textContent = i; }
        }
      });
      $$(".shot").forEach(fig => {
        const img = $("img", fig), box = $(".shot__img", fig);
        gsap.fromTo(img, { xPercent: -9 }, { xPercent: 9, ease: "none", scrollTrigger: { trigger: fig, containerAnimation: tween, start: "left right", end: "right left", scrub: true } });
        gsap.fromTo(box, { clipPath: "inset(18% 12% 18% 12% round 18px)" }, { clipPath: "inset(0% 0% 0% 0% round 18px)", ease: "none", scrollTrigger: { trigger: fig, containerAnimation: tween, start: "left 100%", end: "left 55%", scrub: true } });
        gsap.fromTo($("figcaption", fig), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, scrollTrigger: { trigger: fig, containerAnimation: tween, start: "left 75%", toggleActions: "play none none reverse" } });
      });
    });
    mm.add("(max-width: 900px)", () => {
      // each photo pins under the nav; the next one slides over it and pushes it back into the dark
      const shots = $$(".shot");
      shots.forEach((fig, i) => {
        const box = $(".shot__img", fig), img = $("img", fig), next = shots[i + 1];
        gsap.fromTo(box, { clipPath: "inset(14% 8% 0% 8% round 24px)" }, { clipPath: "inset(0% 0% 0% 0% round 24px)", ease: "none", scrollTrigger: { trigger: fig, start: "top bottom", end: "top 45%", scrub: true } });
        gsap.fromTo(img, { yPercent: -6 }, { yPercent: 6, ease: "none", scrollTrigger: { trigger: fig, start: "top bottom", end: "bottom top", scrub: true } });
        if (next) gsap.fromTo(box, { scale: 1, filter: "brightness(1)" }, { scale: .9, filter: "brightness(.35)", ease: "none", immediateRender: false, scrollTrigger: { trigger: next, start: "top bottom", end: "top 20%", scrub: true } });
      });
    });
  }

  /* ---------- intro ---------- */
  function playIntro() {
    return new Promise(resolve => {
      const intro = $("#intro");
      const seen = store.sget("derby-intro");
      if (reduced || !hasGsap || !window.Billiards || seen) { intro.remove(); resolve(); return; }
      store.sset("derby-intro", "1");
      const ctl = Billiards.runIntro($("#introCanvas"));
      let finished = false;
      gsap.set(".intro__crest", { y: 20 });
      const tl = gsap.timeline({ delay: ctl.strikeAt / 1000 + .3 });
      tl.to(".intro__canvas", { opacity: .45, filter: "blur(5px)", duration: 1.2, ease: "power2.out" }, 0)
        .to(".intro__crest", { opacity: 1, y: 0, duration: 1, ease: "expo.out" }, 0)
        .fromTo(".intro__word span", { opacity: 0, yPercent: 70, filter: "blur(14px)" }, { opacity: 1, yPercent: 0, filter: "blur(0px)", stagger: .06, duration: 1, ease: "expo.out" }, .05)
        .fromTo(".intro__sub", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 1, ease: "expo.out" }, .35)
        .add(() => finish(false), "+=1.1");
      // a tap during the intro counts as permission for sound
      function finish(tapped) {
        if (finished) return; finished = true; tl.kill();
        if (tapped) unlockSound();
        gsap.timeline({ onComplete() { ctl.stop(); intro.remove(); } })
          .to(".intro__skip", { autoAlpha: 0, duration: .3 })
          .to(".intro__brand", { scale: 1.3, opacity: 0, filter: "blur(10px)", duration: .8, ease: "power3.in" }, 0)
          .to(intro, { opacity: 0, duration: .8, ease: "power2.inOut" }, .3)
          .add(resolve, .4);
      }
      intro.addEventListener("click", () => finish(true));
    });
  }

  /* ---------- boot ---------- */
  const fontsReady = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 2500))]);
  // always start at the top; browsers like to restore the old scroll on reload
  const toTop = () => { if (hasGsap) ScrollTrigger.clearScrollMemory("manual"); scrollTo(0, 0); if (lenis) lenis.scrollTo(0, { immediate: true, force: true }); };
  addEventListener("pageshow", toTop);
  fontsReady.then(() => {
    toTop();
    movePill();
    initGame();
    initCursor();
    initCards();
    if (hasGsap) {
      ScrollTrigger.config({ ignoreMobileResize: true });
      initHero();
      initSpace();
      initReveals();
      initNav();
      initMagnetic();
    } else {
      $$(".hero__content, .hero__hud").forEach(el => el.style.visibility = "visible");
    }
    return playIntro();
  }).then(() => {
    document.body.classList.remove("is-loading");
    if (!location.hash) toTop();
    if (lenis) lenis.start();
    if (hasGsap) { heroEnter(); ScrollTrigger.refresh(); }
    tryAutoSound();
  });
})();
