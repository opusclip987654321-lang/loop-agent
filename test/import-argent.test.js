import test from 'node:test';
import assert from 'node:assert/strict';
import { convertir } from '../scripts/import-cerveau-argent.js';

const cerveau = {
  lignes: [
    { id: 'l1', libelle: 'Claude (abonnement)', projet: 'commun', montant: 100, devise: '€', frequence: 'mois', date: null },
    { id: 'l2', libelle: 'ElevenLabs', projet: 'extrait-politique', montant: 24, devise: '$', frequence: 'mois', date: '2026-10-04' },
    { id: 'l3', libelle: 'Twilio (recharge)', projet: 'nour-meet', montant: 20, devise: '€', frequence: 'une-fois', date: '2026-09-22' },
  ],
  factures: [
    { id: 'f1', nom: 'Invoice-1.pdf', ajoutee: '2026-10-05', lecture: { estUneFacture: true, fournisseur: 'ElevenLabs', montant: 24, devise: '$', date: '2026-10-04', ligne: 'l2' } },
    { id: 'f2', nom: 'Receipt-1.pdf', ajoutee: '2026-10-05', lecture: { estUneFacture: true, fournisseur: 'ElevenLabs', montant: 24, devise: '$', date: '2026-10-04', ligne: 'l2' }, doublonDe: 'Invoice-1.pdf' },
    { id: 'f3', nom: 'photo.png', ajoutee: '2026-10-06', lecture: { estUneFacture: false } },
  ],
  corrections: [{ id: 'c1', libelle: 'ElevenLabs', avant: { montant: 7, devise: '€' }, apres: { montant: 24, devise: '$', date: '2026-10-04' } }],
};

test('import du cerveau : format Loop Agent', () => {
  const { money, ajout } = convertir(cerveau, { expenses: [], invoices: [], corrections: [], ai: [] });
  assert.deepEqual([ajout.depenses, ajout.factures, ajout.corrections], [3, 3, 1]);
  const [claude, eleven, twilio] = money.expenses;
  assert.equal(claude.freq, 'mois');
  assert.equal(claude.since, '2026-09');
  assert.equal(twilio.freq, 'une fois');
  assert.equal(twilio.project, 'Nūr Meet');
  assert.deepEqual(eleven.invoice, { date: '2026-10-04', amount: 24 });
  assert.equal(money.invoices[0].state, 'lue');
  assert.equal(money.invoices[0].match, 'ElevenLabs');
  assert.equal(money.invoices[1].state, 'doublon');
  assert.equal(money.invoices[2].state, 'pas-facture');
  assert.match(money.corrections[0].detail, /7 € → 24 \$/);
});

test('import du cerveau : relancer n’ajoute rien, ne touche pas aux saisies existantes', () => {
  const mine = { id: 'e1', name: 'VPS Loop', amount: 5, cur: '€', freq: 'mois' };
  const first = convertir(cerveau, { expenses: [mine], invoices: [], corrections: [], ai: [] }).money;
  const again = convertir(cerveau, first);
  assert.deepEqual([again.ajout.depenses, again.ajout.factures, again.ajout.corrections], [0, 0, 0]);
  assert.deepEqual(again.money.expenses[0], mine);
  assert.equal(again.money.expenses.length, 4);
});
