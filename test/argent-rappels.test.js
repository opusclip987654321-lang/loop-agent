import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextDue, monthTotals, renewalsDue, fmtSum, createArgentRappels } from '../server/argent-rappels.js';

const money = {
  expenses: [
    { id: 'a', name: 'VPS Nūr (OVH)', amount: 10.19, cur: '€', freq: 'mois', date: '2026-09-24', project: 'Commun (plusieurs projets)', invoice: { date: '2026-10-24' }, since: '2026-09' },
    { id: 'b', name: 'Domaine leviaro.fr', amount: 6, cur: '€', freq: 'an', date: '2025-11-10', project: 'Leviaro', invoice: null, since: '2026-09' },
    { id: 'c', name: 'Claude', amount: 100, cur: '€', freq: 'mois', date: '', project: 'Commun (plusieurs projets)', since: '2026-09' },
    { id: 'd', name: 'Anthropic (recharge)', amount: 12, cur: '$', freq: 'une fois', date: '2026-10-08', project: 'Commun (plusieurs projets)' },
    { id: 'e', name: 'Twilio', amount: 20, cur: '€', freq: 'une fois', date: '2026-09-22', project: 'Nūr Meet' },
  ],
};

test('prochaine échéance : comme la page Argent (mois, an, fin de mois)', () => {
  assert.equal(nextDue(money.expenses[0], '2026-11-08'), '2026-11-24');
  assert.equal(nextDue(money.expenses[1], '2026-11-08'), '2026-11-10');
  assert.equal(nextDue({ freq: 'mois', date: '2026-01-31' }, '2026-02-15'), '2026-02-28');
  assert.equal(nextDue({ freq: 'mois', date: '' }, '2026-02-15'), null);
});

test('total d’un mois : abonnements (annuel / 12) + recharges du mois, devises séparées', () => {
  const r = monthTotals(money, '2026-10');
  assert.equal(Math.round(r.total['€'] * 100) / 100, Math.round((10.19 + 0.5 + 100) * 100) / 100);
  assert.equal(r.total['$'], 12);
  assert.equal(r.nbRecharges, 1);
  assert.equal(fmtSum(r.recharges), '12 $');
  assert.equal(monthTotals(money, '2026-09').recharges['€'], 20);
});

test('renouvellements dans les 3 jours seulement', () => {
  const d = renewalsDue(money, '2026-11-08');
  assert.deepEqual(d.map((x) => [x.e.id, x.days]), [['b', 2]]);
});

function setup(t0) {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-argent-'));
  let t = t0;
  const notes = [];
  const db = { getDoc: () => ({ value: JSON.stringify(money) }) };
  const r = createArgentRappels({ db, dataDir, notify: async (m) => notes.push(m), now: () => t, log: { error() {} } });
  return { r, notes, set: (v) => (t = v), done: () => rmSync(dataDir, { recursive: true, force: true }) };
}

test('rappel de renouvellement : en journée, une seule fois par échéance', async () => {
  const s = setup(Date.parse('2026-11-08T02:00:00Z')); // 3 h à Paris : on attend
  try {
    await s.r.tick();
    assert.equal(s.notes.length, 0);
    s.set(Date.parse('2026-11-08T09:00:00Z')); // 10 h à Paris
    await s.r.tick();
    assert.equal(s.notes.length, 1);
    assert.match(s.notes[0], /Domaine leviaro\.fr — 6 € par an, dans 2 jours \(10\/11\) · Leviaro · pas de facture rangée/);
    await s.r.tick();
    assert.equal(s.notes.length, 1, 'pas deux fois la même échéance');
  } finally {
    s.done();
  }
});

test('bilan du mois fini : le 1er, après 9 h, une seule fois', async () => {
  const s = setup(Date.parse('2026-11-01T06:00:00Z')); // 7 h à Paris
  try {
    await s.r.tick();
    assert.equal(s.notes.filter((n) => n.includes('Dépenses de')).length, 0);
    s.set(Date.parse('2026-11-01T09:30:00Z'));
    await s.r.tick();
    const b = s.notes.filter((n) => n.includes('Dépenses de'));
    assert.equal(b.length, 1);
    assert.match(b[0], /Dépenses de octobre 2026 : 110,69 € \+ 12 \$/);
    assert.match(b[0], /Recharges : 12 \$ \(1\)/);
    await s.r.tick();
    assert.equal(s.notes.filter((n) => n.includes('Dépenses de')).length, 1);
  } finally {
    s.done();
  }
});
