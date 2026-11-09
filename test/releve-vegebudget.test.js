import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireStats, appliquer } from '../server/releve-vegebudget.js';

const rep = {
  jours: [
    { jour: '2026-11-08', visiteurs: 41, inscrits: 2, semaines: 3 },
    { jour: '2026-11-09', visiteurs: 12, inscrits: 0 },
    { jour: 'pas-une-date', visiteurs: 99 },
  ],
  totaux: { membres: 37, abonnes: 3 },
};
const kpis = [
  { id: 'k-visites', name: 'Nombre de visites sur le site', agg: 'somme', status: 'valide' },
  { id: 'k-inscr', name: "Nombres d'inscriptions sur le site", agg: 'somme', status: 'valide' },
  { id: 'k-abo', name: "Nombre d'abonnement payant sur le site", agg: 'dernier', status: 'valide' },
];

test('lit les chiffres du site et remplit les 3 indicateurs, sans double compte', () => {
  const s = lireStats(rep);
  assert.equal(s.jours.length, 2);
  assert.equal(s.abonnes, 3);
  const doc = { kpis, kpiValues: [{ id: 'x', kpi: 'k-visites', date: '2026-11-08', source: 'agent', value: 5 }] };
  appliquer(doc, s, '2026-11-09', '2026-11-09T10:00:00Z');
  appliquer(doc, s, '2026-11-09', '2026-11-09T11:00:00Z');
  const v = (kpi, date) => doc.kpiValues.filter((x) => x.kpi === kpi && x.date === date);
  assert.deepEqual(v('k-visites', '2026-11-08').map((x) => x.value), [41], 'la valeur lue sur le site remplace celle de l’agent');
  assert.equal(v('k-inscr', '2026-11-08')[0].value, 2);
  assert.equal(v('k-abo', '2026-11-09')[0].value, 3);
  assert.equal(doc.kpiValues.length, 5);
  assert.throws(() => lireStats({}), /illisible/);
});
