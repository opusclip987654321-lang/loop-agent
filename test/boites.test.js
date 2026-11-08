import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classerMail, lireReponse, createBoites, WEBHOOK_RE } from '../server/boites.js';

const mail = (o) => ({ de: 'Jean <jean@exemple.fr>', objet: '', extrait: '', nonLu: false, ...o });

test('tri des mails : mêmes règles que le cerveau', () => {
  assert.equal(classerMail(mail({ objet: 'Proposition de partenariat' })).niveau, 'urgent');
  assert.equal(classerMail(mail({ de: 'no-reply@youtube.com', objet: 'Avertissement : strike sur ta chaîne' })).niveau, 'urgent');
  assert.equal(classerMail(mail({ de: 'newsletter@site.fr', objet: 'Devis offert' })), null, 'un envoi automatique qui parle argent ne compte pas');
  assert.equal(classerMail(mail({ objet: 'Salut', nonLu: true })).niveau, 'a-traiter');
  assert.equal(classerMail(mail({ objet: 'Salut' })), null);
  assert.equal(classerMail(mail({ de: 'gougamwalid@gmail.com', objet: 'facture' })), null, 'tes propres mails sont ignorés');
});

const reponse = [
  { boite: 'opusclip', lus: 3 },
  { boite: 'gougamwalid', lus: 2 },
  { boite: 'impacteurmedia', erreur: 'accès Google expiré' },
  { boite: 'opusclip', id: 'm1', threadId: 't1', From: 'Marque <pro@marque.fr>', Subject: 'Collaboration sponsorisée', snippet: 'Bonjour', labelIds: ['UNREAD'], internalDate: '1762560000000' },
  { boite: 'opusclip', id: 'm1', From: 'doublon', Subject: 'x' },
  { boite: 'gougamwalid', id: 'm2', From: 'Ami <ami@x.fr>', Subject: 'Coucou', labelIds: ['UNREAD'] },
];

test('lecture de la réponse n8n : boîtes lues, en panne, doublons écartés', () => {
  const { etat, mails } = lireReponse(reponse);
  assert.equal(etat.opusclip.lue, true);
  assert.equal(etat.impacteurmedia.lue, false);
  assert.equal(etat.walidvideos12.erreur, 'pas dans la réponse de n8n');
  assert.deepEqual(mails.map((m) => [m.id, m.niveau]), [['m1', 'urgent'], ['m2', 'a-traiter']]);
});

test('un mail urgent part une seule fois ; l’adresse invalide est ignorée', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-boites-'));
  try {
    const notes = [];
    const b = createBoites({ dataDir, notify: async (t) => notes.push(t), fetchImpl: async () => ({ ok: true, json: async () => reponse }), log: { error() {} } });
    assert.deepEqual(await b.tick(), { ignore: true }, 'sans adresse rangée, rien ne se passe');
    writeFileSync(join(dataDir, 'boites.json'), JSON.stringify({ url: 'https://exemple.com/x' }));
    assert.deepEqual(await b.tick(), { ignore: true });
    writeFileSync(join(dataDir, 'boites.json'), JSON.stringify({ url: 'https://n8n.nourmeet.com/webhook/cerveau-boites-' + 'a'.repeat(32) }));
    const r = await b.tick();
    assert.equal(r.nouveaux, 1);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /📬 1 mail\(s\) urgent\(s\)[\s\S]*Marque \(opusclip\) : Collaboration sponsorisée[\s\S]*mail\.google\.com/);
    await b.tick();
    assert.equal(notes.length, 1, 'pas deux fois le même mail');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('toutes les boîtes muettes : une alerte par jour au plus', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-boites-'));
  try {
    writeFileSync(join(dataDir, 'boites.json'), JSON.stringify({ url: 'https://n8n.nourmeet.com/webhook/cerveau-boites-' + 'b'.repeat(32) }));
    const notes = [];
    const b = createBoites({ dataDir, notify: async (t) => notes.push(t), fetchImpl: async () => ({ ok: true, json: async () => [] }), log: { error() {} } });
    await b.tick();
    await b.tick();
    assert.equal(notes.length, 1);
    assert.match(notes[0], /aucune des 6 boîtes/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('forme de l’adresse secrète', () => {
  assert.ok(WEBHOOK_RE.test('https://n8n.nourmeet.com/webhook/cerveau-boites-0123456789abcdef0123456789abcdef'));
  assert.ok(!WEBHOOK_RE.test('https://n8n.nourmeet.com/webhook/autre'));
});
