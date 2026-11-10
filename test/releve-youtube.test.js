import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireFlux, publicationsParJour, appliquer, fluxDe, createReleveYoutube } from '../server/releve-youtube.js';

const entree = (id, publie, vues) => `<entry>\n<id>yt:video:${id}</id>\n<yt:videoId>${id}</yt:videoId>\n<title>Titre jamais gardé</title>\n<published>${publie}</published>\n<media:group><media:community><media:statistics views="${vues}"/></media:community></media:group>\n</entry>`;
const flux = (entrees) => `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entrees.join('')}</feed>`;
const kpis = [
  { id: 'k-long', name: 'Nombre de vidéos longue posté', agg: 'somme', status: 'valide' },
  { id: 'k-heures', name: "Nombres d'heures de vues", agg: 'dernier', status: 'valide' },
  { id: 'k-abo', name: 'Nouveaux abonnés YouTube', agg: 'somme', status: 'valide' },
  { id: 'k-vues', name: 'Vues des Shorts', agg: 'somme', status: 'valide' },
  { id: 'k-shorts', name: 'Shorts publiés', agg: 'somme', status: 'valide' },
];

test('lit un flux : identifiant, date et vues seulement ; un flux cassé est refusé', () => {
  const v = lireFlux(flux([entree('pj0hfFdArr0', '2026-11-10T11:30:18+00:00', 12), entree('Ow6VpVcvxCA', '2026-11-06T17:00:00+00:00', 375)]));
  assert.deepEqual(v.map((x) => [x.id, x.vues]), [['pj0hfFdArr0', 12], ['Ow6VpVcvxCA', 375]]);
  assert.deepEqual(Object.keys(v[0]).sort(), ['id', 'publie', 'vues']);
  assert.throws(() => lireFlux('<html>consentement</html>'), /illisible/);
  assert.match(fluxDe('UCoTR63ZFhLWw11ZMUYGTR3w').shorts, /playlist_id=UUSHoTR63ZFhLWw11ZMUYGTR3w$/);
  assert.match(fluxDe('UCoTR63ZFhLWw11ZMUYGTR3w').longues, /playlist_id=UULFoTR63ZFhLWw11ZMUYGTR3w$/);
});

test('publications par jour de Paris ; un flux plein ne dit rien des jours trop anciens', () => {
  // 23 h 30 UTC le 9 = 0 h 30 à Paris le 10.
  const peu = lireFlux(flux([entree('aaaaaaaaaaa', '2026-11-09T23:30:00+00:00', 1), entree('bbbbbbbbbbb', '2026-11-08T17:00:00+00:00', 1)]));
  const p = publicationsParJour(peu, '2026-11-10', 4);
  assert.deepEqual(p, { '2026-11-10': 1, '2026-11-09': 0, '2026-11-08': 1, '2026-11-07': 0 });
  const plein = lireFlux(flux(Array.from({ length: 15 }, (_, i) => entree(`v${String(i).padStart(10, '0')}`, `2026-11-${String(10 - Math.floor(i / 5)).padStart(2, '0')}T12:00:00+00:00`, 1))));
  assert.deepEqual(publicationsParJour(plein, '2026-11-10', 6), { '2026-11-10': 5, '2026-11-09': 5 }, 'le 08 (plus vieille vidéo du flux) et avant : indisponibles');
});

test('remplit vidéos longues, Shorts publiés et vues gagnées ; jamais les abonnés ni les heures', () => {
  const doc = { kpis, kpiValues: [{ id: 'a', kpi: 'k-long', date: '2026-11-09', source: 'agent', value: 3 }] };
  const longues = lireFlux(flux([entree('longue00001', '2026-11-09T17:00:00+00:00', 30)]));
  const jour1 = { longues, shorts: lireFlux(flux([entree('short000001', '2026-11-08T11:30:00+00:00', 100)])) };
  appliquer(doc, jour1, '2026-11-09', 'x');
  const v = (k, d) => doc.kpiValues.filter((x) => x.kpi === k && x.date === d).map((x) => x.value);
  assert.deepEqual(v('k-long', '2026-11-09'), [1], 'remplace la mesure de l’agent');
  assert.deepEqual(v('k-shorts', '2026-11-08'), [1]);
  assert.deepEqual(v('k-vues', '2026-11-09'), [], 'premier jour : pas de point de départ, indisponible');
  // Même jour, plus tard : toujours pas de point de départ.
  appliquer(doc, { longues, shorts: lireFlux(flux([entree('short000001', '2026-11-08T11:30:00+00:00', 130)])) }, '2026-11-09', 'x');
  assert.deepEqual(v('k-vues', '2026-11-09'), []);
  // Lendemain : +50 sur l'ancien Short, 20 sur un Short publié le jour même.
  const jour2 = { longues, shorts: lireFlux(flux([entree('short000002', '2026-11-10T11:30:00+00:00', 20), entree('short000001', '2026-11-08T11:30:00+00:00', 180)])) };
  appliquer(doc, jour2, '2026-11-10', 'y');
  assert.deepEqual(v('k-vues', '2026-11-10'), [70]);
  appliquer(doc, { longues, shorts: lireFlux(flux([entree('short000002', '2026-11-10T11:30:00+00:00', 25), entree('short000001', '2026-11-08T11:30:00+00:00', 190)])) }, '2026-11-10', 'z');
  assert.deepEqual(v('k-vues', '2026-11-10'), [85], 'le relevé suivant du même jour remplace, sans double compte');
  assert.deepEqual(v('k-shorts', '2026-11-10'), [1]);
  assert.equal(doc.kpiValues.some((x) => x.kpi === 'k-abo' || x.kpi === 'k-heures'), false);
});

test('un tour complet lit les deux flux et écrit dans le projet ; YouTube en panne ne casse rien d’autre', async () => {
  let doc = { kpis, kpiValues: [] };
  let version = 1;
  const db = { getDoc: (k) => (k === 'project:petites-histoires' ? { value: JSON.stringify(doc), version } : null), putDoc: (k, v) => ((doc = JSON.parse(v)), version++, { ok: true }) };
  const appels = [];
  const fetchImpl = async (url) => (appels.push(String(url)), { ok: true, text: async () => flux([entree('short000001', '2026-11-10T08:00:00+00:00', 5)]) });
  const r = await createReleveYoutube({ db, fetchImpl, now: () => Date.parse('2026-11-10T12:00:00Z') }).tick();
  assert.equal(appels.length, 2);
  assert.ok(r['petites-histoires'].length > 0);
  assert.equal(doc.releveYoutube.jour, '2026-11-10');
  await assert.rejects(createReleveYoutube({ db, fetchImpl: async () => ({ ok: false, status: 429 }) }).tick(), /429/);
});
