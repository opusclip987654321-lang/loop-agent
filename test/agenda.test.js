import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools, agendaDayRange, agendaMonthlyTotals } from '../server/agent-tools.js';
import { describeEvent } from '../server/telegram.js';

const PROJET = 'gestion-immo-banque';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-agenda-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  const project = () => JSON.parse(db.getDoc('project:' + PROJET).value);
  return { db, tools, project, done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}
// Données fictives (le dépôt est public : jamais les vrais montants de Walid).
const box = { projet: PROJET, type: 'Prélèvement', libelle: 'Box internet', organisme: 'Opérateur A', compte: 'Banque A', recurrence: 'mensuel', jour: '9-12', montant: 30, d_ou: 'Relevé fictif' };

test('agenda : l’agent note un prélèvement mensuel une seule fois, puis le met à jour', async () => {
  const s = setup();
  try {
    const msg = await s.tools.enregistrer_agenda.handler(box);
    assert.match(msg, /le 9-12 de chaque mois/);
    await s.tools.enregistrer_agenda.handler({ ...box, montant: 31.5, note: 'Rejeté une fois.' });
    let list = s.project().agenda;
    assert.equal(list.length, 1, 'même libellé, compte et récurrence : mis à jour, pas dupliqué');
    assert.equal(list[0].amount, 31.5);
    assert.equal(list[0].certainty, 'sûre');
    assert.equal(list[0].state, 'actif');

    await s.tools.enregistrer_agenda.handler({ projet: PROJET, type: 'Entrée d’argent', libelle: 'Aide', compte: 'Banque A', recurrence: 'mensuel', jour: '5', montant: 100, d_ou: 'Relevé fictif' });
    await s.tools.enregistrer_agenda.handler({ projet: PROJET, type: 'Virement à faire', libelle: 'Syndic', compte: 'Banque A', recurrence: 'mensuel', jour: 'à choisir', montant: 50, d_ou: 'Mail fictif' });
    await s.tools.enregistrer_agenda.handler({ projet: PROJET, type: 'Assemblée générale', libelle: 'AG copropriété X', recurrence: 'annuel', mois: 'octobre 2027', certitude: 'supposée', d_ou: 'Convocations passées' });
    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.agenda.liste.length, 4);
    assert.deepEqual(p.agenda.par_mois_eur, { 'Banque A': { sorties: 81.5, entrees: 100 } });
    const ag = p.agenda.liste.find((e) => e.type === 'Assemblée générale');
    assert.equal(ag.certitude, 'supposée');
    assert.equal(ag.mois, 'octobre 2027');

    const id = s.project().agenda[0].id;
    await s.tools.enregistrer_agenda.handler({ projet: PROJET, id, etat: 'à confirmer' });
    assert.equal(s.project().agenda[0].state, 'à confirmer');
  } finally {
    s.done();
  }
});

test('agenda : un événement ponctuel sans mois devient « supposée » par défaut, avec date « sûre »', async () => {
  const s = setup();
  try {
    await s.tools.enregistrer_agenda.handler({ projet: PROJET, type: 'Assemblée générale', libelle: 'AG Y', recurrence: 'ponctuel', date: '2027-03-10', d_ou: 'Convocation fictive' });
    await s.tools.enregistrer_agenda.handler({ projet: PROJET, type: 'Assemblée générale', libelle: 'AG Z', recurrence: 'ponctuel', mois: 'mars 2027', d_ou: 'Habitude' });
    const list = s.project().agenda;
    assert.equal(list.find((e) => e.label === 'AG Y').certainty, 'sûre');
    assert.equal(list.find((e) => e.label === 'AG Z').certainty, 'supposée');
  } finally {
    s.done();
  }
});

test('agenda : refus des champs manquants, d’un jour invalide, d’un IBAN, d’un id inconnu', async () => {
  const s = setup();
  try {
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, libelle: '' }), /libelle/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, type: 'Inconnu' }), /type/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, recurrence: 'hebdo' }), /recurrence/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, jour: '' }), /jour/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, jour: '32' }), /jour/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, jour: '12-9' }), /jour/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, montant: 0 }), /positif/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, d_ou: '' }), /d_ou/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, compte: 'FR76 3000 1234' }), /IBAN/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, recurrence: 'ponctuel', jour: undefined }), /mois/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, recurrence: 'ponctuel', date: '10/03/2027' }), /AAAA-MM-JJ/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, certitude: 'peut-être' }), /certitude/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ projet: PROJET, id: 'agenda-nope' }), /introuvable/);
    await assert.rejects(s.tools.enregistrer_agenda.handler({ ...box, projet: 'inconnu' }), /Projet inconnu/);
    const doc = s.db.getDoc('project:' + PROJET);
    assert.equal(doc ? (JSON.parse(doc.value).agenda || []).length : 0, 0, 'aucune ligne écrite après un refus');
  } finally {
    s.done();
  }
});

test('agenda : rien dans lire_projet tant qu’aucune ligne n’est notée', async () => {
  const s = setup();
  try {
    await s.tools.enregistrer_document.handler({ projet: PROJET, nom: 'x', type: 'Charges', etat: 'pris en compte', retenu: 'x', d_ou: 'y' });
    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.agenda, undefined);
  } finally {
    s.done();
  }
});

test('agenda : jours et totaux mensuels', () => {
  assert.deepEqual(agendaDayRange('20'), [20, 20]);
  assert.deepEqual(agendaDayRange('9-12'), [9, 12]);
  assert.equal(agendaDayRange('à choisir'), null);
  assert.equal(agendaDayRange('0'), null);
  const t = agendaMonthlyTotals([
    { recurrence: 'mensuel', kind: 'Prélèvement', account: 'A', amount: 10, state: 'actif' },
    { recurrence: 'mensuel', kind: 'Prélèvement', account: 'A', amount: 5, state: 'arrêté' },
    { recurrence: 'mensuel', kind: 'Entrée d’argent', account: 'A', amount: 7, state: 'actif' },
    { recurrence: 'annuel', kind: 'Assemblée générale', account: 'A', state: 'actif' },
    { recurrence: 'mensuel', kind: 'Prélèvement', amount: 2, state: 'à confirmer' },
  ]);
  assert.deepEqual(t, { A: { sorties: 10, entrees: 7 }, 'compte non précisé': { sorties: 2, entrees: 0 } });
});

test('agenda : pas de Telegram pour une ligne notée', () => {
  assert.equal(describeEvent('enregistrer_agenda', { libelle: 'x' }), null);
});
