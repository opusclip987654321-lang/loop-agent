import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, nettoyerProjets, appliquerProjet } from '../server/releve-serveurs.js';

const sponsors = [
  { id: 'k-mails', name: 'Mails envoyés', agg: 'somme', status: 'valide' },
  { id: 'k-pos', name: 'Réponses positives reçus', agg: 'somme', status: 'valide' },
  { id: 'k-sect', name: 'Nombre de secteur différent prospecté', agg: 'somme', status: 'valide' },
  { id: 'k-rdv', name: 'Rendez-vous ou appels obtenus', agg: 'somme', status: 'valide' },
  { id: 'k-sign', name: 'Sponsors signés', agg: 'somme', status: 'valide' },
];
const leviaro = [
  { id: 'k-prem', name: 'Premiers mails envoyés', agg: 'somme', status: 'valide' },
  { id: 'k-hum', name: 'Réponses humaines', agg: 'somme', status: 'valide' },
  { id: 'k-int', name: 'Intéressés et rendez-vous', agg: 'somme', status: 'valide' },
  { id: 'k-dos', name: 'Dossiers envoyables (note 75 ou plus)', agg: 'somme', status: 'valide' },
  { id: 'k-cli', name: 'Clients signés', agg: 'somme', status: 'valide' },
  { id: 'k-taux', name: 'Taux de réponse aux premiers mails', agg: 'dernier', status: 'valide' },
  { id: 'k-google', name: 'Clics depuis Google', agg: 'somme', status: 'valide' },
];

test('seuls les projets connus, des dates et des nombres entrent', () => {
  const p = nettoyerProjets({
    'impacteur-sponsors': { jours: { '2026-11-10': { mails_envoyes: 12, nom: 'Kolonell', rdv: '1', 'Clé Bizarre': 3, secteurs: -2 }, hier: { mails_envoyes: 1 } }, etat: { total: 300, note: 'x' } },
    nourmeet: { jours: { '2026-11-10': { x: 1 } } },
    inconnu: { jours: { '2026-11-10': { x: 1 } } },
  });
  assert.deepEqual(Object.keys(p), ['impacteur-sponsors']);
  assert.deepEqual(p['impacteur-sponsors'].jours, { '2026-11-10': { mails_envoyes: 12 } });
  assert.deepEqual(p['impacteur-sponsors'].etat, { total: 300 });
  assert.deepEqual(nettoyerProjets(null), {});
  assert.deepEqual(nettoyerProjets({ leviaro: 'texte' }), {});
});

test('Impacteur Sponsors : chaque clé remplit son indicateur ; une clé absente ne touche à rien', () => {
  const doc = { kpis: sponsors, kpiValues: [{ id: 'a', kpi: 'k-mails', date: '2026-11-10', source: 'agent', value: 30 }, { id: 'b', kpi: 'k-sign', date: '2026-11-10', source: 'agent', value: 1 }] };
  const r = nettoyerProjets({ 'impacteur-sponsors': { jours: { '2026-11-09': { mails_envoyes: 28, reponses_positives: 0, rdv: 0, secteurs: 4 }, '2026-11-10': { mails_envoyes: 31, reponses_positives: 1, rdv: 1, secteurs: 5 } } } })['impacteur-sponsors'];
  appliquerProjet(doc, PLANS['impacteur-sponsors'], r, '2026-11-10', 'x');
  appliquerProjet(doc, PLANS['impacteur-sponsors'], r, '2026-11-10', 'y');
  const v = (k, d) => doc.kpiValues.filter((x) => x.kpi === k && x.date === d).map((x) => x.value);
  assert.deepEqual(v('k-mails', '2026-11-10'), [31], 'le relevé remplace la mesure recopiée par l’agent, sans double compte');
  assert.deepEqual(v('k-mails', '2026-11-09'), [28]);
  assert.deepEqual(v('k-pos', '2026-11-10'), [1]);
  assert.deepEqual(v('k-rdv', '2026-11-10'), [1]);
  assert.deepEqual(v('k-sect', '2026-11-10'), [5]);
  assert.deepEqual(v('k-sign', '2026-11-10'), [1], 'sponsors signés absents du relevé : la mesure de l’agent reste');
  assert.equal(doc.kpiValues.find((x) => x.kpi === 'k-mails' && x.date === '2026-11-10').source, 'releve-serveur');
});

test('Leviaro : indicateurs du jour et taux de réponse sur 30 jours', () => {
  const doc = { kpis: leviaro, kpiValues: [] };
  const r = nettoyerProjets({ leviaro: { jours: { '2026-11-10': { premiers_mails: 10, reponses_humaines: 1, interesses_rdv: 0, dossiers_envoyables: 2 } }, etat: { premiers_mails_30j: 206, reponses_humaines_30j: 3 } } }).leviaro;
  appliquerProjet(doc, PLANS.leviaro, r, '2026-11-10', 'x');
  const v = (k) => (doc.kpiValues.find((x) => x.kpi === k && x.date === '2026-11-10') || {}).value;
  assert.equal(v('k-prem'), 10, 'les premiers mails ne vont pas dans le taux');
  assert.equal(v('k-hum'), 1);
  assert.equal(v('k-int'), 0);
  assert.equal(v('k-dos'), 2);
  assert.equal(v('k-cli'), undefined, 'clients signés non mesurés : indisponible, jamais 0');
  assert.equal(v('k-taux'), 1.5);
  assert.equal(v('k-google'), undefined);
  // Aucun premier mail sur 30 jours : pas de taux.
  const doc2 = { kpis: leviaro, kpiValues: [] };
  appliquerProjet(doc2, PLANS.leviaro, { jours: {}, etat: { premiers_mails_30j: 0, reponses_humaines_30j: 0 } }, '2026-11-10', 'x');
  assert.equal(doc2.kpiValues.length, 0);
  // Un indicateur non validé par Walid ne reçoit rien.
  const doc3 = { kpis: leviaro.map((k) => ({ ...k, status: 'propose' })), kpiValues: [] };
  appliquerProjet(doc3, PLANS.leviaro, r, '2026-11-10', 'x');
  assert.equal(doc3.kpiValues.length, 0);
});
