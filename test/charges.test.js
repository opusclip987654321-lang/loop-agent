import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';

const PROJET = 'gestion-immo-banque';
const LC = globalThis.LACharges;

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-charges-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  const project = () => JSON.parse(db.getDoc('project:' + PROJET).value);
  const add = (a) => tools.enregistrer_charge.handler({ projet: PROJET, copro: 'Copro A', d_ou: 'Document fictif', ...a });
  return { db, tools, project, add, done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}
// Données fictives (le dépôt est public : jamais les vrais montants de Walid).

test('charges : une ligne notée deux fois reste unique, puis se met à jour par son id', async () => {
  const s = setup();
  try {
    await s.add({ type: 'Appel de fonds', libelle: 'Appel T1', date: '2026-01-01', montant: 300 });
    await s.add({ type: 'Appel de fonds', libelle: 'Appel T1', date: '2026-01-01', montant: 300 });
    assert.equal(s.project().charges.length, 1);
    const id = s.project().charges[0].id;
    await s.tools.enregistrer_charge.handler({ projet: PROJET, id, note: 'lu sur l’appel' });
    assert.equal(s.project().charges[0].note, 'lu sur l’appel');
    assert.equal(s.project().charges[0].rubric, 'charges');
  } finally {
    s.done();
  }
});

test('charges : refuse un IBAN, une date mal écrite, un montant négatif hors solde', async () => {
  const s = setup();
  try {
    await assert.rejects(s.add({ type: 'Paiement', date: '2026-01-15', montant: 100, d_ou: 'FR76 3000 1234' }), /IBAN/);
    await assert.rejects(s.add({ type: 'Paiement', date: '15/01/2026', montant: 100 }), /AAAA-MM-JJ/);
    await assert.rejects(s.add({ type: 'Paiement', date: '2026-01-15', montant: -5 }), /positif/);
    await assert.rejects(s.add({ type: 'Paiement', montant: 5 }), /date/);
    // Un solde en faveur de Walid peut être négatif.
    await s.add({ type: 'Solde annoncé', date: '2026-01-31', montant: -20 });
    assert.equal(s.project().charges[0].amount, -20);
  } finally {
    s.done();
  }
});

test('charges : soldes contradictoires, paiement non enregistré ou mal crédité, frais sans justificatif, répétés et en double', async () => {
  const s = setup();
  try {
    await s.add({ type: 'Solde annoncé', date: '2025-12-31', montant: 1000, d_ou: 'Compte de charges fictif' });
    await s.add({ type: 'Appel de fonds', date: '2026-01-01', montant: 300 });
    await s.add({ type: 'Paiement', date: '2026-01-15', montant: 100, banque: 'Banque A', enregistre_par_syndic: 'oui' });
    // Attendu : 1000 + 300 − 100 = 1200 ; le syndic annonce 1500 → écart de 300.
    await s.add({ type: 'Solde annoncé', date: '2026-01-31', montant: 1500, d_ou: 'Situation de compte fictive' });
    // Même date, autre document, autre montant.
    await s.add({ type: 'Solde annoncé', date: '2026-01-31', montant: 1300, d_ou: 'Relance fictive' });
    await s.add({ type: 'Paiement', date: '2026-02-15', montant: 100, enregistre_par_syndic: 'non' });
    await s.add({ type: 'Paiement', date: '2026-03-15', montant: 100, enregistre_par_syndic: 'oui', montant_credite_par_syndic: 80 });
    await s.add({ type: 'Frais ajouté', libelle: 'Relance', categorie_frais: 'Relance', date: '2026-02-05', montant: 30 });
    await s.add({ type: 'Frais ajouté', libelle: 'Relance', categorie_frais: 'Relance', date: '2026-03-05', montant: 30 });
    await s.add({ type: 'Frais ajouté', libelle: 'Relance bis', categorie_frais: 'Relance', date: '2026-03-06', montant: 30 });
    await s.add({ type: 'Frais ajouté', libelle: 'Avocat', categorie_frais: 'Frais d’avocat', date: '2026-03-10', montant: 500, etat_frais: 'contesté' });
    await s.add({ type: 'Frais ajouté', libelle: 'Dossier', categorie_frais: 'Frais de recouvrement (syndic)', date: '2026-03-12', montant: 50, etat_frais: 'justifié', justificatif: true });

    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    const v = p.suivi_charges;
    const types = v.alertes.map((a) => a.type);
    assert.ok(types.includes('Solde incohérent'), 'écart entre deux soldes successifs');
    assert.ok(v.alertes.find((a) => a.type === 'Solde incohérent').texte.match(/1\s200,00 €/));
    assert.ok(types.includes('Soldes contradictoires'), 'deux soldes à la même date');
    assert.ok(types.includes('Paiement non enregistré'));
    assert.ok(types.includes('Écart banque / syndic'));
    assert.equal(types.filter((t) => t === 'Frais sans justificatif').length, 3, 'les 3 relances ; pas le frais contesté ni le justifié');
    assert.ok(types.includes('Frais répétés'));
    assert.ok(types.includes('Frais en double ?'), 'deux relances de 30 € en mars');
    assert.equal(v.alertes[0].gravite, 'rouge', 'le rouge passe en premier');

    const c = v.par_copro[0];
    assert.equal(c.copro, 'Copro A');
    assert.equal(c.totaux_eur.appele, 300);
    assert.equal(c.totaux_eur.paye, 300);
    assert.equal(c.totaux_eur.frais_ajoutes, 640);
    assert.equal(c.frais_par_etat_eur['contesté'], 500);
    assert.equal(c.frais_par_etat_eur['justifié'], 50);
    assert.equal(c.frais_par_etat_eur['à vérifier'], 90);
    const fev = c.mois.find((m) => m.mois === '2026-02');
    assert.deepEqual([fev.appele, fev.paye, fev.frais, fev.ecart], [0, 100, 30, -70]);
    assert.equal(c.dernier_paiement, '2026-03-15');
    // Rien d'écrit dans la base par l'analyse : seulement des lignes.
    assert.ok(s.project().charges.every((l) => l.copro === 'Copro A'));
  } finally {
    s.done();
  }
});

test('charges : signale l’absence de paiement depuis plus de 45 jours quand le syndic continue d’appeler', () => {
  const list = [
    { id: 'a', copro: 'B', kind: 'Paiement', date: '2026-01-15', amount: 50 },
    { id: 'b', copro: 'B', kind: 'Appel de fonds', date: '2026-04-01', amount: 200 },
    { id: 'c', copro: 'B', kind: 'Appel de fonds', date: '2026-07-01', amount: 200 },
  ];
  const a = LC.analyse(list, new Date('2026-08-01T12:00:00Z'));
  const al = a.alertes.find((x) => x.type === 'Pas de paiement noté');
  assert.ok(al);
  assert.match(al.texte, /15\/01\/2026/);
  assert.match(al.texte, /2 appel/);
  // Paiement récent : rien à signaler.
  const ok = LC.analyse([...list, { id: 'd', copro: 'B', kind: 'Paiement', date: '2026-07-20', amount: 200 }], new Date('2026-08-01T12:00:00Z'));
  assert.ok(!ok.alertes.some((x) => x.type === 'Pas de paiement noté'));
});

test('charges : un solde « tout compris » se compare à toutes les rubriques ; deux rubriques ne se mélangent pas', () => {
  const list = [
    { id: '1', copro: 'C', kind: 'Solde annoncé', rubric: 'charges', date: '2026-01-01', amount: 100 },
    { id: '2', copro: 'C', kind: 'Appel de fonds', rubric: 'fonds de travaux', date: '2026-01-10', amount: 20 },
    { id: '3', copro: 'C', kind: 'Appel de fonds', rubric: 'charges', date: '2026-01-10', amount: 50 },
    { id: '4', copro: 'C', kind: 'Solde annoncé', rubric: 'charges', date: '2026-01-31', amount: 150 },
  ];
  assert.ok(!LC.analyse(list).alertes.some((x) => /Solde/.test(x.type)), '100 + 50 = 150 : cohérent, le fonds de travaux est à part');
  const c = LC.analyse(list).copros[0];
  assert.equal(c.soldes_annonces.charges.solde_attendu_aujourdhui, 150);
});

test('charges : une ligne sans copro ou de type inconnu est ignorée par l’analyse', () => {
  const a = LC.analyse([{ id: 'x', kind: 'Paiement', amount: 10, date: '2026-01-01' }, { id: 'y', copro: 'D', kind: 'Autre', amount: 10 }]);
  assert.deepEqual(a, { copros: [], alertes: [] });
});
