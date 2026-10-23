/* DERBY tournament: shared by the TV display and the console */
(function () {
  const q = new URLSearchParams(location.search);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = (q.get("api") || (local ? "http://localhost:8787" : "https://derby-live.onrender.com")).replace(/\/$/, "");

  const BYE = "bye";
  // registration -> live <-> break -> finished
  const STATUS = {
    registration: { ka: "რეგისტრაცია", en: "registration" },
    live: { ka: "მიმდინარეობს", en: "live" },
    break: { ka: "შესვენება", en: "break" },
    finished: { ka: "დასრულდა", en: "finished" }
  };

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function nextPow2(n) { let s = 2; while (s < n) s *= 2; return s; }

  // spreads byes evenly through the draw
  function bitReverseOrder(m) {
    const bits = Math.log2(m), out = [];
    for (let i = 0; i < m; i++) {
      let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      out.push(r);
    }
    return out;
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // knockout bracket for any number of players (2+)
  function makeBracket(players, randomDraw) {
    const ids = (randomDraw ? shuffle(players) : players.slice()).map(p => p.id);
    const size = nextPow2(Math.max(2, ids.length));
    const m = size / 2, byes = size - ids.length;
    const byeAt = new Set(bitReverseOrder(m).slice(0, byes));
    const first = [];
    let k = 0;
    for (let i = 0; i < m; i++) {
      const a = ids[k++];
      const b = byeAt.has(i) ? BYE : ids[k++];
      first.push({ id: "r0m" + i, a, b, winner: null, score: "", table: "", live: false });
    }
    const rounds = [first];
    for (let r = 1, c = m / 2; c >= 1; r++, c /= 2) {
      const row = [];
      for (let i = 0; i < c; i++) row.push({ id: `r${r}m${i}`, a: null, b: null, winner: null, score: "", table: "", live: false });
      rounds.push(row);
    }
    const br = { size, rounds, createdAt: new Date().toISOString() };
    settle(br);
    return br;
  }

  // walk the draw: byes and withdrawals win automatically, winners move up, stale results downstream clear
  function settle(br, outIds) {
    const out = outIds instanceof Set ? outIds : new Set(outIds || []);
    const R = br.rounds;
    for (let r = 0; r < R.length; r++) {
      for (let i = 0; i < R[r].length; i++) {
        const mt = R[r][i];
        if (r > 0) {
          const fa = R[r - 1][i * 2], fb = R[r - 1][i * 2 + 1];
          mt.a = fa.winner || null;
          mt.b = fb.winner || null;
        }
        if (mt.a === BYE && mt.b && mt.b !== BYE) { mt.winner = mt.b; }
        else if (mt.b === BYE && mt.a && mt.a !== BYE) { mt.winner = mt.a; }
        else if (mt.a && mt.b) {
          const aOut = out.has(mt.a), bOut = out.has(mt.b);
          if (!mt.winner || mt.wo) {
            if (aOut && !bOut) { mt.winner = mt.b; mt.wo = true; mt.score = "W/O"; }
            else if (bOut && !aOut) { mt.winner = mt.a; mt.wo = true; mt.score = "W/O"; }
            else if (mt.wo) { mt.winner = null; mt.wo = false; mt.score = ""; mt.doneAt = null; }
          }
        }
        if (mt.winner && mt.winner !== mt.a && mt.winner !== mt.b) { mt.winner = null; mt.score = ""; mt.wo = false; mt.doneAt = null; }
        if (mt.winner) mt.live = false;
      }
    }
    return br;
  }
  function outSet(data) { return new Set(((data && data.players) || []).filter(p => p.out).map(p => p.id)); }

  function isBye(mt) { return mt.a === BYE || mt.b === BYE; }
  function ready(mt) { return !!(mt.a && mt.b && !isBye(mt)); }

  // plain names people understand: round 1, round 2 ... then quarter, semi, final
  function roundName(count, r) {
    if (count === 1) return "ფინალი";
    if (count === 2) return "ნახევარფინალი";
    if (count === 4) return "მეოთხედფინალი";
    return `წრე ${(r || 0) + 1}`;
  }

  // where the winner of match (r, i) goes next and who could be waiting there
  function nextInfo(br, r, i) {
    const R = br.rounds;
    if (r >= R.length - 1) return { final: true };
    const sib = R[r][i ^ 1];
    let opp = null;
    if (sib.winner) opp = { id: sib.winner };
    else if (sib.a === BYE || sib.b === BYE) opp = { id: sib.a === BYE ? sib.b : sib.a };
    else if (sib.a && sib.b) opp = { pair: [sib.a, sib.b] };
    else opp = { later: true };
    return { final: false, round: roundName(R[r + 1].length, r + 1), opp };
  }

  function champion(data) {
    const br = data && data.bracket; if (!br) return null;
    const f = br.rounds[br.rounds.length - 1][0];
    return f && f.winner ? f.winner : null;
  }

  function stats(data) {
    const out = { players: 0, active: 0, total: 0, done: 0, live: 0, round: null };
    if (!data) return out;
    out.players = (data.players || []).length;
    out.active = (data.players || []).filter(p => !p.out).length;
    const br = data.bracket; if (!br) return out;
    br.rounds.forEach((row, r) => row.forEach(mt => {
      if (isBye(mt)) return;
      out.total++;
      if (mt.winner) out.done++;
      if (mt.live && !mt.winner) out.live++;
      if (!mt.winner && out.round === null && (mt.a || mt.b)) out.round = r;
    }));
    return out;
  }

  // the announcement currently meant for the screen, or null
  function activeAnnounce(data, now) {
    const a = data && data.announce;
    if (!a || !a.on || !a.text) return null;
    if (a.until && new Date(a.until).getTime() < (now || Date.now())) return null;
    return a;
  }

  function emptyData() {
    return {
      title: "DERBY Snooker Cup",
      subtitle: "სნუკერის ტურნირი",
      game: "snooker",
      display: "auto",
      status: "registration",
      startAt: "",
      breakInfo: null,
      announce: null,
      players: [],
      bracket: null,
      log: []
    };
  }

  window.DT = { API, BYE, STATUS, uid, makeBracket, settle, outSet, isBye, ready, roundName, nextInfo, champion, stats, activeAnnounce, emptyData };
})();
