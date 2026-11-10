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

test('Pinterest par jour et part des visiteurs qui s’inscrivent (7 jours glissants)', () => {
  const jours = Array.from({ length: 8 }, (_, i) => ({ jour: `2026-11-0${i + 1}`, visiteurs: 10, inscrits: i === 7 ? 2 : 0, sources: { direct: 6, 'pinterest.com': 2, pinterest: 1, 'google.com': 1 } }));
  const k = [
    ...kpis,
    { id: 'k-google', name: 'Visites venues de Google', agg: 'somme', status: 'valide' },
    { id: 'k-insta', name: 'Abonnés Instagram', agg: 'dernier', status: 'valide' },
    { id: 'k-part', name: "Part des visiteurs qui s'inscrivent", agg: 'dernier', status: 'valide' },
    { id: 'k-pin', name: 'Visites venus de Pinterest', agg: 'somme', status: 'valide' },
  ];
  const doc = { kpis: k, kpiValues: [] };
  appliquer(doc, lireStats({ jours, totaux: { abonnes: 1 } }), '2026-11-08', 'x');
  const v = (kpi, date) => (doc.kpiValues.find((x) => x.kpi === kpi && x.date === date) || {}).value;
  assert.equal(v('k-pin', '2026-11-08'), 3);
  assert.equal(v('k-visites', '2026-11-08'), 10, 'les visites du site ne sont pas confondues avec celles de Google ou de Pinterest');
  assert.equal(v('k-google', '2026-11-08'), undefined);
  assert.equal(v('k-insta', '2026-11-08'), undefined, 'les abonnés Instagram ne reçoivent pas les abonnés payants');
  assert.equal(v('k-abo', '2026-11-08'), 1);
  // 2 inscriptions pour 70 visiteurs sur 7 jours = 2,9 %.
  assert.equal(v('k-part', '2026-11-08'), 2.9);
  assert.equal(v('k-part', '2026-11-07'), 0);
  assert.equal(v('k-part', '2026-11-06'), undefined, 'pas 7 jours de recul : indisponible');
  // Ancienne version du site, sans origines par jour : Pinterest reste indisponible, jamais 0.
  const doc2 = { kpis: k, kpiValues: [] };
  appliquer(doc2, lireStats({ jours: [{ jour: '2026-11-08', visiteurs: 0, inscrits: 0 }], totaux: {} }), '2026-11-08', 'x');
  assert.equal(doc2.kpiValues.some((x) => x.kpi === 'k-pin' || x.kpi === 'k-part'), false);
});
