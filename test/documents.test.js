import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';
import { detectDocType } from '../server/app.js';
import { describeEvent } from '../server/telegram.js';

const PROJET = 'gestion-immo-banque';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-documents-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  const project = () => JSON.parse(db.getDoc('project:' + PROJET).value);
  // Un document déposé par Walid depuis l'onglet (comme le fait documents.js).
  function deposer(name, content, mime) {
    const id = 'a'.repeat(23) + String(Math.floor(Math.random() * 9));
    mkdirSync(join(dataDir, 'files'), { recursive: true });
    writeFileSync(join(dataDir, 'files', id), content);
    db.addFile({ id, name, mime, size: content.length });
    const cur = db.getDoc('project:' + PROJET);
    const doc = cur ? JSON.parse(cur.value) : { tasks: [] };
    doc.documents = [{ id: 'doc-w1', name, kind: 'Relevé bancaire', period: '', fileId: id, addedAt: '2026-11-11T08:00:00.000Z', addedBy: 'walid', state: 'à lire' }, ...(doc.documents || [])];
    db.putDoc('project:' + PROJET, JSON.stringify(doc), cur ? cur.version : 0, 'walid');
  }
  return { db, tools, project, deposer, done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}

test('documents : Walid dépose un relevé CSV, l’agent le lit puis le note pris en compte', async () => {
  const s = setup();
  try {
    s.deposer('releve-octobre.csv', Buffer.from('date;libelle;montant\n2026-10-02;Loyer;-850\n'), 'text/csv; charset=utf-8');
    let r = await s.tools.documents_a_lire.handler({ projet: PROJET });
    assert.equal(r.documents.length, 1);
    assert.equal(r.documents[0].id, 'doc-w1');

    r = await s.tools.lire_document.handler({ projet: PROJET, id: 'doc-w1' });
    assert.equal(r.content[0].type, 'text');
    assert.match(r.content[0].text, /Loyer;-850/);

    const msg = await s.tools.enregistrer_document.handler({ projet: PROJET, id: 'doc-w1', etat: 'pris en compte', periode: 'octobre 2026', retenu: 'Loyer de 850 € prélevé le 2.' });
    assert.match(msg, /pris en compte/);
    const d = s.project().documents[0];
    assert.equal(d.state, 'pris en compte');
    assert.equal(d.period, 'octobre 2026');
    assert.equal(d.summary, 'Loyer de 850 € prélevé le 2.');
    assert.equal(d.readBy, 'agent');

    r = await s.tools.documents_a_lire.handler({ projet: PROJET });
    assert.equal(r.documents.length, 0, 'plus rien à lire');
    assert.deepEqual(r.deja_pris_en_compte, ['releve-octobre.csv (Relevé bancaire, octobre 2026)']);

    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.documents.a_lire, 0);
    assert.equal(p.documents.liste[0].etat, 'pris en compte');
    assert.equal(p.documents.liste[0].fichier, 'dans Loop Agent');
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
    await assert.rejects(s.tools.lire_document.handler({ projet: PROJET, id: 'doc-nope' }), /introuvable/);
    const p = await s.tools.lire_projet.handler({ projet: PROJET });
    assert.equal(p.documents, undefined, 'aucun document : rien dans lire_projet');
  } finally {
    s.done();
  }
});

test('documents : formats reconnus par contenu et extension', () => {
  assert.equal(detectDocType(Buffer.from('%PDF-1.7'), 'x.csv').mime, 'application/pdf');
  assert.equal(detectDocType(Buffer.from('a;b\n1;2\n'), 'releve.csv').mime, 'text/csv; charset=utf-8');
  assert.equal(detectDocType(Buffer.from([0x44, 0xe9, 0x62, 0x69, 0x74]), 'releve.CSV').mime, 'text/csv; charset=windows-1252');
  assert.equal(detectDocType(Buffer.from('OFXHEADER:100'), 'releve.ofx').mime, 'application/x-ofx; charset=utf-8');
  assert.equal(detectDocType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'charges.xlsx').ext, '.xlsx');
  assert.equal(detectDocType(Buffer.from('a;b'), 'sans-extension'), null);
  assert.equal(detectDocType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'faux.csv'), null, 'binaire déguisé en CSV refusé');
  assert.equal(detectDocType(Buffer.from('<html>'), 'page.html'), null);
});

test('documents : pas de Telegram pour un document noté', () => {
  assert.equal(describeEvent('enregistrer_document', { etat: 'pris en compte' }), null);
});
