const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({ window: {}, URLSearchParams, location: { search: '', hostname: 'localhost' } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../tournament/shared.js'), 'utf8'), context);
const DT = context.window.DT;
const all = d => d.bracket.rounds.flat();
const live = d => all(d).filter(m => m.live && !m.winner);
function tournament(n, tables = 1) {
  const data = DT.emptyData();
  data.tables = tables;
  data.players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}` }));
  data.bracket = DT.makeBracket(data.players, false);
  data.status = 'live';
  return data;
}
function invariant(d) {
  assert.ok(live(d).length <= DT.tableCount(d));
  assert.equal(new Set(live(d).map(m => m.table)).size, live(d).length);
  assert.equal(new Set(live(d).flatMap(m => [m.a, m.b])).size, live(d).length * 2);
  for (const m of live(d)) assert.ok(Number(m.table) >= 1 && Number(m.table) <= DT.tableCount(d));
}
test('one-table default and invalid table counts', () => {
  assert.equal(DT.emptyData().tables, 1);
  for (const tables of [undefined, null, '', 0, -5, 'bad', Infinity]) assert.equal(DT.tableCount({ tables }), 1);
  assert.equal(DT.tableCount({ tables: 2.8 }), 2);
  assert.equal(DT.tableCount({ tables: 200 }), 20);
});
test('complete brackets from 2 to 128 players, with byes and one or several tables', () => {
  for (let n = 2; n <= 128; n++) for (const tables of [1, 2, 4]) {
    const d = tournament(n, tables); let completed = 0;
    DT.schedule(d, true);
    while (!DT.champion(d)) {
      invariant(d);
      assert.ok(live(d).length, `stalled: ${n} players, ${tables} tables`);
      const m = live(d)[0]; m.winner = m.a; m.doneAt = '2026-10-24T00:00:00Z';
      DT.settle(d.bracket, DT.outSet(d)); DT.schedule(d, true);
      assert.ok(++completed < n);
    }
    assert.equal(completed, n - 1);
    assert.equal(DT.stats(d).done, n - 1);
    assert.equal(live(d).length, 0);
  }
});
test('legacy multiple live flags are limited without losing results or scores', () => {
  const d = tournament(8); delete d.tables;
  const row = d.bracket.rounds[0];
  row.forEach((m, i) => { m.live = true; m.table = String(i + 1); m.score = '2-0'; });
  d.announce = { on: true, kind: 'call', text: 'stale table call' };
  DT.schedule(d, false);
  assert.equal(live(d).length, 1);
  assert.equal(DT.waiting(d).length, 3);
  assert.ok(row.every(m => m.score === '2-0' && !m.winner));
  assert.equal(d.announce.on, false);
});
test('manual calls cannot exceed capacity and cannot start during a break', () => {
  const d = tournament(8); DT.schedule(d, true);
  const next = DT.waiting(d)[0].mt;
  assert.equal(DT.startMatch(d, next.id).error, 'table_busy');
  assert.equal(live(d).length, 1);
  d.status = 'break';
  assert.equal(DT.startMatch(d, next.id).error, 'not_live');
  assert.equal(DT.schedule(d, true).length, 0);
  d.status = 'live'; d.tables = 2; DT.schedule(d, true);
  assert.equal(live(d).length, 2); invariant(d);
});
test('changing capacity requeues excess matches and repairs duplicate table assignments', () => {
  const d = tournament(16, 4); DT.schedule(d, true);
  live(d).forEach(m => { m.table = '20'; });
  DT.schedule(d, false); invariant(d);
  d.tables = 1; DT.schedule(d, true);
  assert.equal(live(d).length, 1); assert.equal(DT.waiting(d).length, 7); invariant(d);
  d.tables = 3; DT.schedule(d, true);
  assert.equal(live(d).length, 3); invariant(d);
});
test('postpone moves a match behind others and does not immediately restart itself', () => {
  const d = tournament(8); DT.schedule(d, true);
  const m = live(d)[0]; m.live = false; m.later = Date.now();
  DT.schedule(d, true, m.id);
  assert.notEqual(live(d)[0].id, m.id);
  assert.equal(DT.waiting(d).at(-1).mt.id, m.id);
  const final = tournament(2); DT.schedule(final, true);
  const only = live(final)[0]; only.live = false; only.later = Date.now();
  DT.schedule(final, true, only.id);
  assert.equal(live(final).length, 0);
  assert.ok(DT.startMatch(final, only.id).match);
});
test('changing an earlier result clears stale downstream scores and live flags', () => {
  const d = tournament(4), [a, b] = d.bracket.rounds[0];
  a.winner = a.a; b.winner = b.a; DT.settle(d.bracket);
  const final = d.bracket.rounds[1][0];
  final.winner = final.b; final.score = '3-1'; final.doneAt = 'yesterday'; final.live = true;
  a.winner = a.b; DT.settle(d.bracket);
  assert.equal(final.winner, null); assert.equal(final.score, ''); assert.equal(final.doneAt, null); assert.equal(final.live, false);
});
test('withdrawals advance opponents and restore clears automatic wins', () => {
  const d = tournament(4); DT.schedule(d, true);
  const m = live(d)[0]; d.players.find(p => p.id === m.a).out = true;
  DT.settle(d.bracket, DT.outSet(d)); DT.schedule(d, true);
  assert.equal(m.winner, m.b); assert.equal(m.wo, true); invariant(d);
  d.players.find(p => p.id === m.a).out = false;
  DT.settle(d.bracket, DT.outSet(d)); DT.schedule(d, true);
  assert.equal(m.winner, null); assert.equal(m.wo, false); invariant(d);
});

test('manual calling supports 20 players on one table in any ready-match order', () => {
  const d = tournament(20); d.autoCall = false;
  assert.equal(DT.schedule(d, true).length, 0);
  let completed = 0;
  while (!DT.champion(d)) {
    assert.equal(live(d).length, 0);
    const options = DT.waiting(d), chosen = options.at(-1).mt;
    assert.ok(DT.startMatch(d, chosen.id).match);
    assert.equal(live(d)[0].id, chosen.id);
    invariant(d);
    const other = DT.waiting(d)[0];
    if (other) assert.equal(DT.startMatch(d, other.mt.id).error, 'table_busy');
    chosen.winner = chosen.a;
    DT.settle(d.bracket, DT.outSet(d));
    assert.equal(DT.schedule(d, true).length, 0);
    assert.ok(++completed < 20);
  }
  assert.equal(completed, 19);
});

test('switching to manual keeps the current match and leaves postponed tables free', () => {
  const d = tournament(8); DT.schedule(d, true);
  const current = live(d)[0]; current.score = '2-1';
  d.autoCall = false; DT.schedule(d, true);
  assert.equal(live(d)[0].id, current.id);
  assert.equal(current.score, '2-1');
  current.live = false; current.later = Date.now();
  DT.schedule(d, true, current.id);
  assert.equal(live(d).length, 0);
  const chosen = DT.waiting(d)[1].mt;
  assert.ok(DT.startMatch(d, chosen.id).match);
  assert.equal(current.score, '2-1');
  d.status = 'break';
  assert.equal(DT.startMatch(d, current.id).error, 'not_live');
  d.status = 'live'; chosen.winner = chosen.a;
  DT.settle(d.bracket); DT.schedule(d, true);
  assert.equal(live(d).length, 0);
  d.autoCall = true; DT.schedule(d, true);
  assert.equal(live(d).length, 1); invariant(d);
});
