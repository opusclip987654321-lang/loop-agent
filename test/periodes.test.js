import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/periodes.js';

const P = globalThis.LAPeriodes;

test('clés de période', () => {
  assert.equal(P.periodKey('2026-11-07', 'semaine'), '2026-W45');
  assert.equal(P.periodKey('2026-01-01', 'semaine'), '2026-W01');
  assert.equal(P.periodKey('2027-01-01', 'semaine'), '2026-W53');
  assert.equal(P.periodKey('2026-11-07', 'mois'), '2026-11');
  assert.equal(P.periodKey('2026-11-07', 'trimestre'), '2026-Q4');
  assert.equal(P.periodKey('2026-11-07', 'semestre'), '2026-H2');
  assert.equal(P.periodKey('2026-11-07', 'annee'), '2026');
});

test('période précédente et libellés', () => {
  assert.equal(P.prevKey('2026-W01', 'semaine'), '2025-W52');
  assert.equal(P.prevKey('2026-01', 'mois'), '2025-12');
  assert.equal(P.prevKey('2026-Q1', 'trimestre'), '2025-Q4');
  assert.equal(P.prevKey('2026-H1', 'semestre'), '2025-H2');
  assert.equal(P.label('2026-W45', 'semaine'), 'sem. du 02/11');
  assert.equal(P.label('2026-11', 'mois'), 'novembre 2026');
  assert.deepEqual(P.lastKeys('mois', 3, new Date('2026-11-07T10:00:00Z')), ['2026-09', '2026-10', '2026-11']);
});

test('valeur d’un indicateur : somme, dernier, absent = null (jamais 0)', () => {
  const vals = [
    { kpi: 'a', date: '2026-11-03', value: 40 },
    { kpi: 'a', date: '2026-11-05', value: 60 },
    { kpi: 'a', date: '2026-11-06', unavailable: true },
    { kpi: 'b', date: '2026-11-03', value: 1200 },
    { kpi: 'b', date: '2026-11-06', value: 1250 },
  ];
  assert.equal(P.kpiValue({ id: 'a', agg: 'somme' }, vals, '2026-W45', 'semaine'), 100);
  assert.equal(P.kpiValue({ id: 'b', agg: 'dernier' }, vals, '2026-W45', 'semaine'), 1250);
  assert.equal(P.kpiValue({ id: 'a', agg: 'somme' }, vals, '2026-W44', 'semaine'), null);
});
