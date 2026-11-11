import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';
import { describeEvent } from '../server/telegram.js';

const PROJET = 'gestion-immo-banque';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-documents-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  const project = () => JSON.parse(db.getDoc('project:' + PROJET).value);
  // Walid signale un document depuis l'onglet (sans fichier, comme le fait documents.js).
  function signaler() {
    const cur = db.getDoc('project:' + PROJET);
    const doc = cur ? JSON.parse(cur.value) : { tasks: [] };
    doc.documents = [{ id: 'doc-w1', name: 'Relevé octobre', kind: 'Relevé bancaire', period: '', source: 'Dossier Banque du Mac', addedAt: '2026-11-11T08:00:00.000Z', addedBy: 'walid', state: 'à lire' }];
    db.putDoc('project:' + PROJET, JSON.stringify(doc), cur ? cur.version : 0, 'walid');
  }
  return { db, tools, project, signaler, done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}

test('documents : Walid signale un relevé, l’agent le note pris en compte', async () => {
  const s = setup();
  try {
    s.signaler();
    let p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.documents.a_lire, 1);
    assert.equal(p.documents.liste[0].ou, 'Dossier Banque du Mac');

    const msg = await s.tools.enregistrer_document.handler({ projet: PROJET, id: 'doc-w1', etat: 'pris en compte', periode: 'octobre 2026', retenu: 'Loyer de 850 € prélevé le 2.' });
    assert.match(msg, /pris en compte/);
    const d = s.project().documents[0];
    assert.equal(d.state, 'pris en compte');
    assert.equal(d.period, 'octobre 2026');
    assert.equal(d.summary, 'Loyer de 850 € prélevé le 2.');
    assert.equal(d.readBy, 'agent');

    p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.documents.a_lire, 0);
    assert.equal(p.documents.liste[0].etat, 'pris en compte');
  } finally {
    s.done();
  }
});

test('documents : un document lu ailleurs est ajouté une seule fois', async () => {
  const s = setup();
  try {
    const args = { projet: PROJET, nom: 'Appel de charges T4', type: 'Charges', periode: 'T4 2026', etat: 'pris en compte', retenu: '420 € à payer avant le 15/12.', d_ou: 'Dossier Immo du Mac' };
    await s.tools.enregistrer_document.handler(args);
    await s.tools.enregistrer_document.handler({ ...args, retenu: '420 € à payer avant le 15/12 (payé).' });
    const docs = s.project().documents;
    assert.equal(docs.length, 1, 'même nom, type et période : mis à jour, pas dupliqué');
    assert.equal(docs[0].source, 'Dossier Immo du Mac');
    assert.equal(docs[0].addedBy, 'agent');
    assert.match(docs[0].summary, /payé/);
  } finally {
    s.done();
  }
});

test('documents : refus des champs manquants, d’un IBAN, d’un id inconnu', async () => {
  const s = setup();
  try {
    await assert.rejects(s.tools.enregistrer_document.handler({ projet: PROJET, etat: 'pris en compte', retenu: 'x', type: 'Charges' }), /nom/);
    await assert.rejects(s.tools.enregistrer_document.handler({ projet: PROJET, nom: 'x', type: 'Inconnu', etat: 'pris en compte', retenu: 'x', d_ou: 'y' }), /type/);
    await assert.rejects(s.tools.enregistrer_document.handler({ projet: PROJET, nom: 'x', type: 'Charges', etat: 'pris en compte', retenu: 'x' }), /d_ou/);
    await assert.rejects(s.tools.enregistrer_document.handler({ projet: PROJET, nom: 'x', type: 'Charges', etat: 'pris en compte', retenu: 'Compte FR76 3000 1234', d_ou: 'y' }), /IBAN/);
    await assert.rejects(s.tools.enregistrer_document.handler({ projet: PROJET, id: 'doc-nope', etat: 'ignoré', retenu: 'doublon' }), /introuvable/);
    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.documents, undefined, 'aucun document : rien dans lire_projet');
  } finally {
    s.done();
  }
});

test('documents : aucun outil ne fait passer le fichier par Loop Agent', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-documents-'));
  const db = openDb(dataDir);
  try {
    const names = createAgentTools({ db, dataDir }).map((t) => t.name);
    assert.ok(names.includes('enregistrer_document'));
    assert.ok(!names.includes('lire_document') && !names.includes('documents_a_lire'));
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('documents : pas de Telegram pour un document noté', () => {
  assert.equal(describeEvent('enregistrer_document', { etat: 'pris en compte' }), null);
});
