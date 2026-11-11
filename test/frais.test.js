import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools, feeTotals } from '../server/agent-tools.js';
import { describeEvent } from '../server/telegram.js';

const PROJET = 'gestion-immo-banque';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-frais-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  const project = () => JSON.parse(db.getDoc('project:' + PROJET).value);
  return { db, tools, project, done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}
const base = { projet: PROJET, libelle: 'Commission d’intervention', categorie: 'Frais d’incident / commission d’intervention', organisme: 'Banque A', date: '2026-10-05', montant: 8, etat: 'payé', d_ou: 'Relevé d’octobre 2026' };

test('frais : l’agent note un frais, une seule fois, puis le met à jour', async () => {
  const s = setup();
  try {
    const msg = await s.tools.enregistrer_frais_evitable.handler(base);
    assert.match(msg, /noté payé/);
    await s.tools.enregistrer_frais_evitable.handler({ ...base, comment_eviter: 'Demander le plafonnement clientèle fragile.' });
    let list = s.project().frais;
    assert.equal(list.length, 1, 'même libellé, organisme et date : mis à jour, pas dupliqué');
    assert.equal(list[0].howToAvoid, 'Demander le plafonnement clientèle fragile.');
    assert.equal(list[0].addedBy, 'agent');

    await s.tools.enregistrer_frais_evitable.handler({ ...base, libelle: 'Frais de saisie', categorie: 'Frais de saisie', date: undefined, periode: 'novembre 2026', montant: 100, etat: 'à venir', estimation: true, d_ou: 'Courrier de la banque du 04/11/2026' });
    let p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.frais_evitables.liste.length, 2);
    assert.deepEqual(p.frais_evitables.totaux_eur, { paye: 8, a_venir: 100, conteste: 0, rembourse: 0, perdu: 8 });
    assert.equal(p.frais_evitables.liste[0].estimation, true);

    const id = s.project().frais.find((f) => f.label === 'Commission d’intervention').id;
    await s.tools.enregistrer_frais_evitable.handler({ projet: PROJET, id, etat: 'contesté', rembourse: 3 });
    p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.deepEqual(p.frais_evitables.totaux_eur, { paye: 8, a_venir: 100, conteste: 8, rembourse: 3, perdu: 5 });
    assert.deepEqual(p.frais_evitables.par_categorie_eur, { 'Frais d’incident / commission d’intervention': 8 });
  } finally {
    s.done();
  }
});

test('frais : refus des champs manquants, d’un montant nul, d’un IBAN, d’un id inconnu', async () => {
  const s = setup();
  try {
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, libelle: '' }), /libelle/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, categorie: 'Inconnue' }), /categorie/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, montant: 0 }), /positif/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, montant: undefined }), /montant/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, d_ou: '' }), /d_ou/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, date: '05/10/2026' }), /AAAA-MM-JJ/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, date: undefined }), /periode/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, d_ou: 'Compte FR76 3000 1234' }), /IBAN/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, etat: 'oublié' }), /etat/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ projet: PROJET, id: 'frais-nope', etat: 'payé' }), /introuvable/);
    await s.tools.enregistrer_frais_evitable.handler(base);
    const id = s.project().frais[0].id;
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ projet: PROJET, id, etat: 'payé', rembourse: 50 }), /rembourse/);
    await assert.rejects(s.tools.enregistrer_frais_evitable.handler({ ...base, projet: 'inconnu' }), /Projet inconnu/);
  } finally {
    s.done();
  }
});

test('frais : rien dans lire_projet tant qu’aucun frais n’est noté', async () => {
  const s = setup();
  try {
    await s.tools.enregistrer_document.handler({ projet: PROJET, nom: 'x', type: 'Charges', etat: 'pris en compte', retenu: 'x', d_ou: 'y' });
    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.frais_evitables, undefined);
  } finally {
    s.done();
  }
});

test('frais : totaux (remboursé en entier, à venir à part)', () => {
  const t = feeTotals([
    { amount: 12, state: 'payé' },
    { amount: 20, state: 'remboursé' },
    { amount: 15, state: 'contesté', refunded: 99 },
    { amount: 100, state: 'à venir' },
  ]);
  assert.deepEqual(t, { paye: 47, a_venir: 100, conteste: 15, rembourse: 35, perdu: 12 });
});

test('frais : pas de Telegram pour un frais noté', () => {
  assert.equal(describeEvent('enregistrer_frais_evitable', { etat: 'payé' }), null);
});
