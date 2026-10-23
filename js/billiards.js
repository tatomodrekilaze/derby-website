/* DERBY · billiards engine
   Small 2D physics + 3D-looking rolling balls, shared by the intro break and the playable table. */
(function () {
  const TAU = Math.PI * 2;

  const COLORS = {
    1: "#f4c22b", 2: "#1f4fbf", 3: "#d8262e", 4: "#5b2a91", 5: "#f2741c", 6: "#11804a", 7: "#7c1e26", 8: "#141519"
  };
  const IVORY = "#f6f1e3";

  /* ---------- ball ---------- */
  function makeBall(num, x, y, r) {
    const stripe = num > 8;
    const color = num === 0 ? IVORY : COLORS[stripe ? num - 8 : num];
    const a = Math.random() * TAU, b = (Math.random() - .5) * 1.4;
    // n: stripe axis, m: number pole (on the band for stripes)
    const n = norm([Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)]);
    let m = stripe ? norm(cross(n, [0, 0, 1])) : norm([Math.random() - .5, Math.random() - .5, .8 + Math.random() * .4]);
    if (!isFinite(m[0])) m = [1, 0, 0];
    if (stripe && m[2] < 0) m = m.map(v => -v);
    return { num, x, y, vx: 0, vy: 0, r, color, stripe, n, m, pocketed: false, sink: 0, sinkX: 0, sinkY: 0, alpha: 1 };
  }
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function rotate(v, k, c, s) { // Rodrigues
    const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const kx = cross(k, v);
    return [v[0] * c + kx[0] * s + k[0] * kv * (1 - c), v[1] * c + kx[1] * s + k[1] * kv * (1 - c), v[2] * c + kx[2] * s + k[2] * kv * (1 - c)];
  }
  function roll(b, dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return;
    const k = [-dy / d, dx / d, 0], th = d / b.r, c = Math.cos(th), s = Math.sin(th);
    b.n = rotate(b.n, k, c, s); b.m = rotate(b.m, k, c, s);
  }

  function shade(hex, amt) {
    const v = parseInt(hex.slice(1), 16);
    let r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; } else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // draws a spherical cap / disc centred on pole p (unit vec) with angular radius ang
  function capPath(ctx, x, y, r, p, ang) {
    const z = p[2];
    const cx = x + p[0] * Math.cos(ang) * r, cy = y + p[1] * Math.cos(ang) * r;
    const rr = Math.sin(ang) * r;
    const phi = Math.atan2(p[1], p[0]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(.001, rr * Math.abs(z)), rr, phi, 0, TAU);
    return { cx, cy, phi, z };
  }

  function drawBall(ctx, b, opts) {
    const r = b.r * (1 - b.sink * .45);
    const x = b.x, y = b.y;
    if (b.alpha <= 0 || r <= 0) return;
    ctx.save();
    ctx.globalAlpha = b.alpha;

    // contact shadow
    const lx = (opts && opts.lightX != null) ? opts.lightX : x - r * 3, ly = (opts && opts.lightY != null) ? opts.lightY : y - r * 4;
    let sdx = x - lx, sdy = y - ly; const sl = Math.hypot(sdx, sdy) || 1; sdx /= sl; sdy /= sl;
    const sg = ctx.createRadialGradient(x + sdx * r * .45, y + sdy * r * .45, r * .2, x + sdx * r * .45, y + sdy * r * .45, r * 1.35);
    sg.addColorStop(0, `rgba(0,0,0,${.55 * (1 - b.sink)})`); sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x + sdx * r * .45, y + sdy * r * .45, r * 1.35, 0, TAU); ctx.fill();

    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.save(); ctx.clip();

    // body
    ctx.fillStyle = b.color; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (b.stripe) {
      ctx.fillStyle = IVORY;
      capPath(ctx, x, y, r, b.n, .82); if (b.n[2] > -.2) ctx.fill();
      const nn = [-b.n[0], -b.n[1], -b.n[2]];
      capPath(ctx, x, y, r, nn, .82); if (nn[2] > -.2) ctx.fill();
    }
    // number disc
    if (b.num > 0 && b.m[2] > 0) {
      const ang = b.stripe ? .36 : .42;
      const c = capPath(ctx, x, y, r, b.m, ang);
      ctx.fillStyle = IVORY; ctx.fill();
      if (r > 5) {
        ctx.save();
        ctx.translate(c.cx, c.cy); ctx.rotate(c.phi); ctx.scale(Math.max(.05, c.z), 1); ctx.rotate(-c.phi);
        ctx.fillStyle = "#111"; ctx.font = `800 ${r * (b.num > 9 ? .5 : .6)}px Unbounded, Manrope, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(b.num), 0, r * .04);
        ctx.restore();
      }
    }

    // shading: rim darkening, key light, bounce light
    const g1 = ctx.createRadialGradient(x - r * .25, y - r * .3, r * .1, x, y, r * 1.05);
    g1.addColorStop(0, "rgba(0,0,0,0)"); g1.addColorStop(.7, "rgba(0,0,0,.08)"); g1.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = g1; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    const g2 = ctx.createRadialGradient(x - r * .38, y - r * .42, 0, x - r * .38, y - r * .42, r * .7);
    g2.addColorStop(0, "rgba(255,255,255,.75)"); g2.addColorStop(.25, "rgba(255,255,255,.22)"); g2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g2; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    const g3 = ctx.createRadialGradient(x + r * .4, y + r * .5, 0, x + r * .4, y + r * .5, r * .6);
    g3.addColorStop(0, "rgba(255,255,255,.12)"); g3.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g3; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();

    // specular
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath(); ctx.ellipse(x - r * .36, y - r * .42, r * .14, r * .09, -.7, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ---------- cue stick ---------- */
  function drawCue(ctx, tipX, tipY, ang, len, w) {
    // ang: direction the cue points (from butt to tip)
    ctx.save();
    ctx.translate(tipX, tipY); ctx.rotate(ang + Math.PI);
    // now +x goes from tip toward butt
    const L = len, wt = w * .45, wb = w;
    const shaft = ctx.createLinearGradient(0, -wb, 0, wb);
    shaft.addColorStop(0, "#c9a46a"); shaft.addColorStop(.35, "#f3dfb4"); shaft.addColorStop(.6, "#e0c08a"); shaft.addColorStop(1, "#9c7440");
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = w * 2.4; ctx.shadowOffsetY = w * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -wt); ctx.lineTo(L, -wb); ctx.lineTo(L, wb); ctx.lineTo(0, wt); ctx.closePath();
    ctx.fillStyle = shaft; ctx.fill();
    ctx.shadowColor = "transparent";
    // butt
    const bs = L * .58;
    const butt = ctx.createLinearGradient(0, -wb, 0, wb);
    butt.addColorStop(0, "#2a0d12"); butt.addColorStop(.4, "#6b1d29"); butt.addColorStop(1, "#1a060a");
    const wAt = t => wt + (wb - wt) * t;
    ctx.beginPath();
    ctx.moveTo(bs, -wAt(bs / L)); ctx.lineTo(L, -wb); ctx.lineTo(L, wb); ctx.lineTo(bs, wAt(bs / L)); ctx.closePath();
    ctx.fillStyle = butt; ctx.fill();
    // points (inlays)
    ctx.fillStyle = "#f3d99d";
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(bs - L * .08, 0); ctx.lineTo(bs + L * .02, s * wAt((bs) / L) * .9); ctx.lineTo(bs + L * .02, 0); ctx.closePath(); ctx.globalAlpha = .55; ctx.fill(); ctx.globalAlpha = 1;
    }
    // gold rings
    ctx.fillStyle = "#e7c27a";
    [bs, bs + L * .02, L * .9].forEach(px => ctx.fillRect(px, -wAt(px / L), Math.max(1, w * .25), wAt(px / L) * 2));
    // ferrule + tip
    ctx.fillStyle = "#f7f3e8"; ctx.fillRect(0, -wt, w * 1.6, wt * 2);
    ctx.fillStyle = "#2c6ed3"; ctx.fillRect(-w * .35, -wt * .95, w * .4, wt * 1.9);
    // highlight
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(w * 1.6, -wt * .55, L * .55, Math.max(.6, w * .14));
    ctx.restore();
  }

  /* ---------- physics ---------- */
  function Sim(o) {
    this.balls = [];
    this.bounds = o.bounds || null;      // {x0,y0,x1,y1}
    this.pockets = o.pockets || [];      // [{x,y,r}]
    this.decel = o.decel; this.damp = o.damp;
    this.eBall = o.eBall ?? .95; this.eRail = o.eRail ?? .76;
    this.onHit = o.onHit || null; this.onRail = o.onRail || null; this.onPocket = o.onPocket || null;
  }
  Sim.prototype.moving = function () {
    return this.balls.some(b => !b.pocketed && (b.vx * b.vx + b.vy * b.vy) > 1e-8) || this.balls.some(b => b.pocketed && b.sink < 1);
  };
  Sim.prototype.step = function (dt) {
    const B = this.balls;
    let vmax = 0, rmin = Infinity;
    for (const b of B) { if (!b.pocketed) { vmax = Math.max(vmax, Math.hypot(b.vx, b.vy)); rmin = Math.min(rmin, b.r); } }
    const n = Math.min(24, Math.max(1, Math.ceil(vmax * dt / (rmin * .35))));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      for (const b of B) {
        if (b.pocketed) continue;
        const dx = b.vx * h, dy = b.vy * h;
        b.x += dx; b.y += dy; roll(b, dx, dy);
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) {
          const ns = Math.max(0, sp - this.decel * h) * (1 - this.damp * h);
          if (ns < this.decel * .004) { b.vx = b.vy = 0; } else { b.vx *= ns / sp; b.vy *= ns / sp; }
        }
        // pockets
        for (const p of this.pockets) {
          if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
            b.pocketed = true; b.sinkX = p.x; b.sinkY = p.y; b.vx = b.vy = 0;
            this.onPocket && this.onPocket(b, p);
            break;
          }
        }
        if (b.pocketed) continue;
        // rails, with gaps at pocket mouths
        const bd = this.bounds;
        if (bd) {
          const nearP = this.pockets.some(p => Math.hypot(b.x - p.x, b.y - p.y) < p.r * 1.9);
          if (!nearP) {
            let hit = 0;
            if (b.x - b.r < bd.x0) { b.x = bd.x0 + b.r; hit = Math.abs(b.vx); b.vx = Math.abs(b.vx) * this.eRail; b.vy *= .96; }
            else if (b.x + b.r > bd.x1) { b.x = bd.x1 - b.r; hit = Math.abs(b.vx); b.vx = -Math.abs(b.vx) * this.eRail; b.vy *= .96; }
            if (b.y - b.r < bd.y0) { b.y = bd.y0 + b.r; hit = Math.max(hit, Math.abs(b.vy)); b.vy = Math.abs(b.vy) * this.eRail; b.vx *= .96; }
            else if (b.y + b.r > bd.y1) { b.y = bd.y1 - b.r; hit = Math.max(hit, Math.abs(b.vy)); b.vy = -Math.abs(b.vy) * this.eRail; b.vx *= .96; }
            if (hit && this.onRail) this.onRail(hit);
          } else {
            // keep it from escaping the table through the jaw
            const m = b.r * .2;
            b.x = Math.min(Math.max(b.x, bd.x0 - b.r * 2 + m), bd.x1 + b.r * 2 - m);
            b.y = Math.min(Math.max(b.y, bd.y0 - b.r * 2 + m), bd.y1 + b.r * 2 - m);
          }
        }
      }
      // ball to ball
      for (let i = 0; i < B.length; i++) {
        const a = B[i]; if (a.pocketed) continue;
        for (let j = i + 1; j < B.length; j++) {
          const c = B[j]; if (c.pocketed) continue;
          let dx = c.x - a.x, dy = c.y - a.y;
          const rr = a.r + c.r, d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2); dx /= d; dy /= d;
          const ov = (rr - d) / 2;
          a.x -= dx * ov; a.y -= dy * ov; c.x += dx * ov; c.y += dy * ov;
          const vn = (a.vx - c.vx) * dx + (a.vy - c.vy) * dy;
          if (vn <= 0) continue;
          const j2 = vn * (1 + this.eBall) / 2;
          a.vx -= j2 * dx; a.vy -= j2 * dy; c.vx += j2 * dx; c.vy += j2 * dy;
          this.onHit && this.onHit(vn);
        }
      }
    }
    // sinking animation
    for (const b of B) {
      if (b.pocketed && b.sink < 1) {
        b.sink = Math.min(1, b.sink + dt * 4);
        b.x += (b.sinkX - b.x) * Math.min(1, dt * 14); b.y += (b.sinkY - b.y) * Math.min(1, dt * 14);
        b.alpha = 1 - b.sink;
      }
    }
  };

  function rack(apexX, apexY, r, dirX, dirY, order) {
    // 15 balls, apex facing -dir; rows grow along dir
    const px = -dirY, py = dirX, gap = r * 2.02;
    const out = []; let k = 0;
    for (let row = 0; row < 5; row++) {
      for (let j = 0; j <= row; j++) {
        const along = row * gap * Math.sqrt(3) / 2;
        const side = (j - row / 2) * gap;
        out.push(makeBall(order[k++], apexX + dirX * along + px * side + (Math.random() - .5) * r * .02, apexY + dirY * along + py * side + (Math.random() - .5) * r * .02, r));
      }
    }
    return out;
  }
  const RACK_ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];

  /* ---------- audio ---------- */
  function buzz(ms) { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) {} }

  const Sfx = {
    ctx: null, on: true, last: 0,
    unlock() {
      if (this.ctx) { this.ctx.state === "suspended" && this.ctx.resume(); return; }
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    },
    noise(dur) {
      const c = this.ctx, len = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const s = c.createBufferSource(); s.buffer = buf; return s;
    },
    clack(v) {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      if (t - this.last < .012) return; this.last = t;
      const vol = Math.min(1, v) * .55;
      const s = this.noise(.035), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "bandpass"; f.frequency.value = 2600 + Math.random() * 900; f.Q.value = 2.2;
      g.gain.value = vol; s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.value = 1900 + Math.random() * 500; og.gain.setValueAtTime(vol * .25, t); og.gain.exponentialRampToValueAtTime(.0001, t + .05);
      o.connect(og); og.connect(c.destination); o.start(t); o.stop(t + .06);
    },
    thump(v) {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime, s = this.noise(.08), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "lowpass"; f.frequency.value = 380; g.gain.value = Math.min(1, v) * .7;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
    },
    drop() {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + .25);
      g.gain.setValueAtTime(.45, t); g.gain.exponentialRampToValueAtTime(.0001, t + .32);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + .35);
      setTimeout(() => this.clack(.35), 120);
    }
  };

  /* =========================================================
     INTRO: the break
     ========================================================= */
  function runIntro(canvas, cb) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W, H;
    function size() { W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    const unit = Math.min(W, H);
    const r = Math.max(9, unit * .026);
    const portrait = H > W;
    // rack points right on landscape, up on portrait
    const dir = portrait ? [0, -1] : [1, 0];
    const apex = portrait ? [W / 2, H * .5] : [W * .56, H / 2];
    const sim = new Sim({ decel: unit * .55, damp: .9, eBall: .93 });
    // on phones the balls bounce off the screen edges instead of flying away
    if (portrait) { sim.bounds = { x0: 0, y0: 0, x1: W, y1: H }; sim.eRail = .7; sim.damp = 1.3; }
    sim.balls = rack(apex[0], apex[1], r, dir[0], dir[1], RACK_ORDER);
    const cue = makeBall(0, portrait ? W / 2 : W * .2, portrait ? H * .82 : H / 2, r);
    cue.y += (Math.random() - .5) * r * .1; cue.x += portrait ? (Math.random() - .5) * r * .1 : 0;
    sim.balls.push(cue);

    const t0 = performance.now();
    let last = t0, struck = false, raf, done = false;
    const strikeAt = 1050, speed = unit * 4.6;

    function frame(now) {
      const t = now - t0, dt = Math.min(.033, (now - last) / 1000); last = now;
      if (!struck && t >= strikeAt) { struck = true; cue.vx = dir[0] * speed; cue.vy = dir[1] * speed; }
      if (struck) sim.step(dt);

      ctx.clearRect(0, 0, W, H);
      // lamp pool
      const lampA = Math.min(1, t / 600);
      const lg = ctx.createRadialGradient(apex[0] - dir[0] * unit * .1, apex[1] - dir[1] * unit * .1, 0, W / 2, H / 2, Math.max(W, H) * .6);
      lg.addColorStop(0, `rgba(30,110,200,${.38 * lampA})`); lg.addColorStop(.45, `rgba(14,50,100,${.22 * lampA})`); lg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);

      const fade = Math.min(1, t / 450);
      for (const b of sim.balls) { b.alpha = fade; drawBall(ctx, b, { lightX: W / 2, lightY: H * .3 }); }

      // cue stick: slide in, draw back, strike
      if (t < strikeAt + 260) {
        let gapPx;
        if (t < 520) gapPx = r * 9 * (1 - easeOut(t / 520)) + r * 1.4;
        else if (t < strikeAt - 150) gapPx = r * 1.4 + r * 3.2 * easeInOut((t - 520) / (strikeAt - 670));
        else if (t < strikeAt) gapPx = (r * 4.6) * (1 - (t - (strikeAt - 150)) / 150);
        else gapPx = -r * .2;
        const ca = Math.min(1, t / 300) * (t > strikeAt ? Math.max(0, 1 - (t - strikeAt) / 260) : 1);
        const ang = Math.atan2(dir[1], dir[0]);
        ctx.globalAlpha = ca;
        const tipX = (struck ? cue.x - dir[0] * cue.r : cue.x) - dir[0] * (r + gapPx), tipY = (struck ? cue.y - dir[1] * cue.r : cue.y) - dir[1] * (r + gapPx);
        if (!struck) drawCue(ctx, tipX, tipY, ang, unit * 1.1, Math.max(3, r * .32));
        ctx.globalAlpha = 1;
      }
      if (!done) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    const onR = () => size(); addEventListener("resize", onR);
    return {
      stop() { done = true; cancelAnimationFrame(raf); removeEventListener("resize", onR); },
      strikeAt
    };
  }
  function easeOut(t) { t = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { t = Math.min(1, Math.max(0, t)); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* =========================================================
     GAME: playable table
     ========================================================= */
  function Game(canvas, hooks) {
    this.cv = canvas; this.ctx = canvas.getContext("2d"); this.hooks = hooks || {};
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.portrait = false;
    this.aim = { x: 0, y: 0, active: false, down: false, startD: 0, power: 0, has: false };
    this.shots = 0; this.potted = 0; this.visible = false; this.shotAnim = 0;
    this.layout(); this.reset();
    this.bind();
    const loop = (now) => { this.tick(now); requestAnimationFrame(loop); };
    this.last = performance.now(); requestAnimationFrame(loop);
  }
  const RAIL = .11, R = .031, LONG = 2, SHORT = 1;

  Game.prototype.layout = function () {
    const rect = this.cv.getBoundingClientRect();
    this.cw = Math.max(10, rect.width); this.ch = Math.max(10, rect.height);
    this.cv.width = Math.round(this.cw * this.dpr); this.cv.height = Math.round(this.ch * this.dpr);
    const portrait = this.ch > this.cw;
    const changed = portrait !== this.portrait; this.portrait = portrait;
    this.TW = portrait ? SHORT : LONG; this.TH = portrait ? LONG : SHORT;
    this.s = Math.min(this.cw / (this.TW + RAIL * 2), this.ch / (this.TH + RAIL * 2));
    this.ox = (this.cw - (this.TW + RAIL * 2) * this.s) / 2 + RAIL * this.s;
    this.oy = (this.ch - (this.TH + RAIL * 2) * this.s) / 2 + RAIL * this.s;
    this.pockets = this.makePockets();
    if (this.sim) { this.sim.bounds = { x0: 0, y0: 0, x1: this.TW, y1: this.TH }; this.sim.pockets = this.pockets; }
    this.renderStatic();
    return changed;
  };
  Game.prototype.makePockets = function () {
    const W = this.TW, H = this.TH, c = .062, m = .052, k = .012;
    const P = [{ x: -k, y: -k, r: c }, { x: W + k, y: -k, r: c }, { x: -k, y: H + k, r: c }, { x: W + k, y: H + k, r: c }];
    if (this.portrait) P.push({ x: -k * 2.4, y: H / 2, r: m }, { x: W + k * 2.4, y: H / 2, r: m });
    else P.push({ x: W / 2, y: -k * 2.4, r: m }, { x: W / 2, y: H + k * 2.4, r: m });
    return P;
  };
  Game.prototype.headSpot = function () { return this.portrait ? { x: this.TW / 2, y: this.TH * .75 } : { x: this.TW * .25, y: this.TH / 2 }; };
  Game.prototype.reset = function () {
    const self = this;
    this.sim = new Sim({
      bounds: { x0: 0, y0: 0, x1: this.TW, y1: this.TH }, pockets: this.pockets,
      decel: .42, damp: .32, eBall: .95, eRail: .74,
      onHit: v => Sfx.clack(v / 2.4),
      onRail: v => Sfx.thump(v / 3),
      onPocket: b => self.pocket(b)
    });
    const foot = this.portrait ? { x: this.TW / 2, y: this.TH * .27 } : { x: this.TW * .73, y: this.TH / 2 };
    const dir = this.portrait ? [0, -1] : [1, 0];
    const order = RACK_ORDER.slice(1).sort(() => Math.random() - .5); order.unshift(1);
    const i8 = order.indexOf(8); order[i8] = order[4]; order[4] = 8;
    this.sim.balls = rack(foot.x, foot.y, R, dir[0], dir[1], order);
    const hs = this.headSpot();
    this.cue = makeBall(0, hs.x, hs.y, R); this.sim.balls.push(this.cue);
    this.shots = 0; this.potted = 0; this.scratched = false;
    this.hooks.update && this.hooks.update(this);
  };
  Game.prototype.pocket = function (b) {
    Sfx.drop();
    buzz(b.num === 0 ? [30, 40, 30] : 22);
    if (b.num === 0) { this.scratched = true; this.hooks.toast && this.hooks.toast("scratch"); }
    else { this.potted++; this.hooks.toast && this.hooks.toast("nice"); this.hooks.update && this.hooks.update(this); }
  };
  Game.prototype.toTable = function (e) {
    const rect = this.cv.getBoundingClientRect();
    return { x: (e.clientX - rect.left - this.ox) / this.s, y: (e.clientY - rect.top - this.oy) / this.s };
  };
  Game.prototype.canShoot = function () { return !this.sim.moving() && !this.cue.pocketed && this.potted < 15; };
  Game.prototype.bind = function () {
    const cv = this.cv, A = this.aim;
    cv.addEventListener("pointermove", e => {
      const p = this.toTable(e); A.x = p.x; A.y = p.y; A.has = true;
      if (A.down) {
        const d = Math.hypot(this.cue.x - p.x, this.cue.y - p.y);
        A.power = Math.max(0, Math.min(1, (d - A.startD) / .55));
      }
    });
    cv.addEventListener("pointerdown", e => {
      Sfx.unlock();
      if (!this.canShoot()) return;
      cv.setPointerCapture(e.pointerId);
      const p = this.toTable(e); A.x = p.x; A.y = p.y; A.has = true; A.down = true; A.power = 0;
      A.startD = Math.hypot(this.cue.x - p.x, this.cue.y - p.y);
      e.preventDefault();
    });
    const up = () => {
      if (!A.down) return; A.down = false;
      if (A.power > .02 && this.canShoot()) {
        const dx = this.cue.x - A.x, dy = this.cue.y - A.y, d = Math.hypot(dx, dy) || 1;
        const v = .25 + Math.pow(A.power, 1.15) * 5.2;
        this.cue.vx = dx / d * v; this.cue.vy = dy / d * v;
        this.shots++; this.shotAnim = 1; this.lastPower = A.power;
        Sfx.clack(.4 + A.power * .6);
        buzz(8 + Math.round(A.power * 14));
        this.hooks.update && this.hooks.update(this);
        this.hooks.shot && this.hooks.shot();
      }
      A.power = 0;
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", () => { A.down = false; A.power = 0; });
    cv.addEventListener("pointerleave", () => { if (!A.down) A.has = false; });
  };

  Game.prototype.tick = function (now) {
    const dt = Math.min(.033, (now - this.last) / 1000); this.last = now;
    if (!this.visible) return;
    const wasMoving = this.sim.moving();
    this.sim.step(dt);
    if (wasMoving && !this.sim.moving()) this.settle();
    this.shotAnim = Math.max(0, this.shotAnim - dt * 6);
    this.draw();
  };
  Game.prototype.settle = function () {
    if (this.cue.pocketed) {
      const hs = this.headSpot(); let x = hs.x, y = hs.y, tries = 0;
      while (this.sim.balls.some(b => b !== this.cue && !b.pocketed && Math.hypot(b.x - x, b.y - y) < R * 2.2) && tries++ < 40) {
        if (this.portrait) x = this.TW / 2 + (Math.random() - .5) * .6; else y = this.TH / 2 + (Math.random() - .5) * .6;
      }
      Object.assign(this.cue, { x, y, vx: 0, vy: 0, pocketed: false, sink: 0, alpha: 1 });
    }
    if (this.potted >= 15) this.hooks.win && this.hooks.win();
  };

  Game.prototype.renderStatic = function () {
    const c = document.createElement("canvas");
    c.width = this.cv.width; c.height = this.cv.height;
    const x = c.getContext("2d"), s = this.s, d = this.dpr;
    x.setTransform(d, 0, 0, d, 0, 0);
    const W = this.TW * s, H = this.TH * s, ox = this.ox, oy = this.oy, rw = RAIL * s;

    // outer rail (burgundy, like the club's pool tables)
    rr(x, ox - rw, oy - rw, W + rw * 2, H + rw * 2, rw * .9);
    const rg = x.createLinearGradient(0, oy - rw, 0, oy + H + rw);
    rg.addColorStop(0, "#8f2638"); rg.addColorStop(.5, "#5a1222"); rg.addColorStop(1, "#3a0a15");
    x.fillStyle = rg; x.fill();
    x.save(); x.clip();
    x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 2; rr(x, ox - rw + 1, oy - rw + 1, W + rw * 2 - 2, H + rw * 2 - 2, rw * .9); x.stroke();
    x.restore();
    // gold corner caps
    x.fillStyle = "#d9b46a";
    [[ox, oy], [ox + W, oy], [ox, oy + H], [ox + W, oy + H]].forEach(([cx, cy]) => {
      const g = x.createRadialGradient(cx - rw * .2, cy - rw * .2, 0, cx, cy, rw * 1.05);
      g.addColorStop(0, "#fff0c4"); g.addColorStop(.5, "#d4a856"); g.addColorStop(1, "#7b5520");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rw * 1.02, 0, TAU); x.fill();
    });
    // diamonds
    x.fillStyle = "rgba(255,240,205,.85)";
    const dm = (px, py) => { x.save(); x.translate(px, py); x.rotate(Math.PI / 4); x.fillRect(-rw * .07, -rw * .07, rw * .14, rw * .14); x.restore(); };
    for (let i = 1; i < 8; i++) { if (i === 4) continue; const px = ox + W * i / 8; dm(this.portrait ? ox - rw * .5 : px, this.portrait ? oy + H * i / 8 : oy - rw * .5); dm(this.portrait ? ox + W + rw * .5 : px, this.portrait ? oy + H * i / 8 : oy + H + rw * .5); }
    for (let i = 1; i < 4; i++) { const py = oy + H * i / 4; const px = ox + W * i / 4; if (this.portrait) { dm(px, oy - rw * .5); dm(px, oy + H + rw * .5); } else { dm(ox - rw * .5, py); dm(ox + W + rw * .5, py); } }

    // cloth with lamp light
    const cush = rw * .32;
    x.fillStyle = "#0d4f92"; x.fillRect(ox - cush, oy - cush, W + cush * 2, H + cush * 2);
    const fg = x.createRadialGradient(ox + W / 2, oy + H / 2, 0, ox + W / 2, oy + H / 2, Math.max(W, H) * .62);
    fg.addColorStop(0, "#3a9cf0"); fg.addColorStop(.45, "#1a78d0"); fg.addColorStop(1, "#0a4583");
    x.fillStyle = fg; x.fillRect(ox, oy, W, H);
    // cushion shading
    const sh = x.createLinearGradient(0, 0, 0, 1);
    x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = cush * .5; x.strokeRect(ox - cush * .25, oy - cush * .25, W + cush * .5, H + cush * .5);
    // cloth noise
    const n = document.createElement("canvas"); n.width = n.height = 128; const nx = n.getContext("2d"), id = nx.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 14; }
    nx.putImageData(id, 0, 0); x.fillStyle = x.createPattern(n, "repeat"); x.fillRect(ox, oy, W, H);
    // lines and spots
    x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 1;
    x.beginPath();
    if (this.portrait) { x.moveTo(ox, oy + H * .75); x.lineTo(ox + W, oy + H * .75); } else { x.moveTo(ox + W * .25, oy); x.lineTo(ox + W * .25, oy + H); }
    x.stroke();
    x.fillStyle = "rgba(255,255,255,.4)";
    const fs = this.portrait ? [ox + W / 2, oy + H * .27] : [ox + W * .73, oy + H / 2];
    x.beginPath(); x.arc(fs[0], fs[1], 2.2, 0, TAU); x.fill();
    // pockets
    this.pockets.forEach(p => {
      const px = ox + p.x * s, py = oy + p.y * s, pr = p.r * s * 1.05;
      const g = x.createRadialGradient(px, py + pr * .2, pr * .2, px, py, pr);
      g.addColorStop(0, "#000"); g.addColorStop(.75, "#050505"); g.addColorStop(1, "#1d1d1d");
      x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fill();
      x.strokeStyle = "rgba(217,180,106,.55)"; x.lineWidth = 1.5; x.beginPath(); x.arc(px, py, pr + 1, 0, TAU); x.stroke();
    });
    this.static = c;
  };
  function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

  Game.prototype.raycast = function (ox, oy, dx, dy) {
    let best = Infinity, hitBall = null;
    for (const b of this.sim.balls) {
      if (b === this.cue || b.pocketed) continue;
      const fx = ox - b.x, fy = oy - b.y, R2 = (R * 2) ** 2;
      const bq = fx * dx + fy * dy, c = fx * fx + fy * fy - R2, disc = bq * bq - c;
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t > 0 && t < best) { best = t; hitBall = b; }
    }
    // walls
    const tx = dx > 0 ? (this.TW - R - ox) / dx : dx < 0 ? (R - ox) / dx : Infinity;
    const ty = dy > 0 ? (this.TH - R - oy) / dy : dy < 0 ? (R - oy) / dy : Infinity;
    const tw = Math.min(tx, ty);
    if (tw < best) return { t: tw, ball: null };
    return { t: best, ball: hitBall };
  };

  Game.prototype.draw = function () {
    const x = this.ctx, d = this.dpr, s = this.s, ox = this.ox, oy = this.oy;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, this.cv.width, this.cv.height);
    x.drawImage(this.static, 0, 0);
    x.setTransform(d, 0, 0, d, 0, 0);
    const lamp = { lightX: ox + this.TW * s / 2, lightY: oy + this.TH * s / 2 };
    const A = this.aim, cue = this.cue;

    // aim guide
    const showAim = this.canShoot() && A.has;
    let dir = null;
    if (showAim) {
      const dx = cue.x - A.x, dy = cue.y - A.y, dl = Math.hypot(dx, dy);
      if (dl > R * .5) {
        dir = [dx / dl, dy / dl];
        const hit = this.raycast(cue.x, cue.y, dir[0], dir[1]);
        const hx = cue.x + dir[0] * hit.t, hy = cue.y + dir[1] * hit.t;
        x.save();
        x.setLineDash([2, 7]); x.lineCap = "round"; x.lineWidth = 2;
        x.strokeStyle = `rgba(255,255,255,${.35 + A.power * .45})`;
        x.beginPath(); x.moveTo(ox + cue.x * s, oy + cue.y * s); x.lineTo(ox + hx * s, oy + hy * s); x.stroke();
        x.setLineDash([]);
        x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1.5;
        x.beginPath(); x.arc(ox + hx * s, oy + hy * s, R * s, 0, TAU); x.stroke();
        if (hit.ball) {
          const nx = hit.ball.x - hx, ny = hit.ball.y - hy, nl = Math.hypot(nx, ny) || 1;
          const g = x.createLinearGradient(ox + hit.ball.x * s, oy + hit.ball.y * s, ox + (hit.ball.x + nx / nl * .32) * s, oy + (hit.ball.y + ny / nl * .32) * s);
          g.addColorStop(0, "rgba(255,179,71,.95)"); g.addColorStop(1, "rgba(255,179,71,0)");
          x.strokeStyle = g; x.lineWidth = 3;
          x.beginPath(); x.moveTo(ox + hit.ball.x * s, oy + hit.ball.y * s); x.lineTo(ox + (hit.ball.x + nx / nl * .32) * s, oy + (hit.ball.y + ny / nl * .32) * s); x.stroke();
        }
        x.restore();
      }
    }

    for (const b of this.sim.balls) {
      if (b.pocketed && b.sink >= 1) continue;
      const sb = Object.assign({}, b, { x: ox + b.x * s, y: oy + b.y * s, r: b.r * s });
      drawBall(x, sb, lamp);
    }

    // cue stick
    if (dir || this.shotAnim > 0) {
      if (dir) this.lastDir = dir;
      const dd = this.lastDir || [1, 0];
      const pull = A.down ? A.power * .32 : (this.shotAnim > 0 ? -.01 : .035);
      const gap = this.shotAnim > 0 ? (this.lastPower || .5) * .32 * (this.shotAnim) : pull;
      if (this.shotAnim > 0 && !dir) { x.globalAlpha = this.shotAnim; }
      const cx = this.shotAnim > 0 ? this.shotFrom || [cue.x, cue.y] : [cue.x, cue.y];
      if (dir && this.shotAnim === 0) this.shotFrom = [cue.x, cue.y];
      const tipX = ox + (cx[0] - dd[0] * (R + .006 + gap)) * s, tipY = oy + (cx[1] - dd[1] * (R + .006 + gap)) * s;
      drawCue(x, tipX, tipY, Math.atan2(dd[1], dd[0]), 1.45 * s, Math.max(2.5, R * s * .34));
      x.globalAlpha = 1;
    }

    // power meter
    if (A.down && A.power > 0) {
      const px = ox + cue.x * s, py = oy + cue.y * s, rad = R * s * 2.3;
      x.lineWidth = 3; x.strokeStyle = "rgba(255,255,255,.15)"; x.beginPath(); x.arc(px, py, rad, 0, TAU); x.stroke();
      const g = x.createLinearGradient(px - rad, py, px + rad, py); g.addColorStop(0, "#f3d99d"); g.addColorStop(1, "#ff7a18");
      x.strokeStyle = g; x.beginPath(); x.arc(px, py, rad, -Math.PI / 2, -Math.PI / 2 + TAU * A.power); x.stroke();
    }
  };

  window.Billiards = { runIntro, Game, Sfx, drawBall, makeBall };
})();
