import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireFiches, appliquer, jourDe } from '../server/releve-impacteur.js';

const rep = [
  { statut: 'CONFIG' },
  { statut: 'ENVOYE', auteur: 'X', date_envoi: '05/11/2026 10:00', reponse_le: '07/11/2026', reponse_type: 'OUI_INTERVIEW' },
  { statut: 'ENVOYE', date_envoi: '2026-11-07 09:00', reponse_le: '2026-11-08T08:00:00Z', reponse_type: 'LIVRE_ACCEPTE' },
  { statut: 'ENVOYE', date_envoi: '07/11/2026', reponse_le: '', reponse_type: '' },
  { statut: 'A_ENVOYER', date_envoi: '', reponse_type: '' },
];
const kpis = [
  { id: 'k-env', name: 'Nombre de mails envoyés', agg: 'somme', status: 'valide' },
  { id: 'k-pos', name: 'Réponses positives reçus', agg: 'somme', status: 'valide' },
  { id: 'k-int', name: 'Interviews obtenues', agg: 'somme', status: 'valide' },
  { id: 'k-tx', name: 'Taux de réponse aux invitations', agg: 'dernier', status: 'valide' },
];

test('dates lues comme le cerveau', () => {
  assert.equal(jourDe('07/11/2026 10:00'), '2026-11-07');
  assert.equal(jourDe('2026-11-07T23:30:00Z'), '2026-11-08');
  assert.equal(jourDe(''), null);
});

test('envois, réponses positives, interviews et taux, sans nom ni texte', () => {
  const lu = lireFiches(rep);
  assert.equal(lu.fiches.length, 4);
  assert.equal(lu.reponsesMesurees, true);
  const doc = { kpis, kpiValues: [] };
  appliquer(doc, lu, '2026-11-09', '2026-11-09T10:00:00Z');
  const v = (k, d) => (doc.kpiValues.find((x) => x.kpi === k && x.date === d) || {}).value;
  assert.equal(v('k-env', '2026-11-05'), 1);
  assert.equal(v('k-env', '2026-11-07'), 2);
  assert.equal(v('k-pos', '2026-11-07'), 1);
  assert.equal(v('k-pos', '2026-11-08'), 1);
  assert.equal(v('k-int', '2026-11-07'), 1);
  assert.equal(v('k-int', '2026-11-08'), 0);
  assert.equal(v('k-tx', '2026-11-09'), 66.7);
  assert.ok(!JSON.stringify(doc).includes('"X"'), 'aucun nom n’entre dans Loop Agent');
  appliquer(doc, lu, '2026-11-09', '2026-11-09T11:00:00Z');
  assert.equal(doc.kpiValues.filter((x) => x.kpi === 'k-env' && x.date === '2026-11-07').length, 1, 'pas de double compte');
});
