import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools, demandesDansTexte } from '../server/agent-tools.js';
import { decisionsBetween } from '../server/routines.js';
import { describeEvent } from '../server/telegram.js';

test('repère « Pour Walid : … » et « Walid doit … », mais pas le tableau « Fait pour Walid »', () => {
  assert.deepEqual(demandesDansTexte('Contrôle fait. Pour Walid : me donner accès à Search Console. Suite lundi.'), ['me donner accès à Search Console.']);
  assert.deepEqual(demandesDansTexte('Walid doit choisir A ou D. Le reste avance.'), ['Walid doit choisir A ou D.']);
  assert.deepEqual(demandesDansTexte('Ligne ajoutée dans « Fait pour Walid » : 3 mails.'), []);
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-dem-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  return { db, tools, doc: () => JSON.parse(db.getDoc('project:ebook').value), done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}

test('une demande reste ouverte et l’action rouge, même après la validation du premier résultat', async () => {
  const s = setup();
  try {
    const p = await s.tools.lire_projet.handler({ projet: 'ebook' });
    const action = p.actions[0].id;
    const msg = await s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Couvertures prêtes. Walid doit choisir A ou D.', decision: 'Attendre.' });
    assert.match(msg, /1 demande\(s\) à Walid enregistrée/);
    // Walid valide le premier résultat (ce que fait la page) : la demande ne bouge pas.
    const key = 'project:ebook';
    const cur = s.db.getDoc(key);
    const d = JSON.parse(cur.value);
    const t = d.tasks.find((x) => x.id === action);
    t.firstRunPending = false;
    t.autonomy = 'Autonome';
    s.db.putDoc(key, JSON.stringify(d), cur.version, 'walid');
    const apres = await s.tools.lire_projet.handler({ projet: 'ebook' });
    const a = apres.actions.find((x) => x.id === action);
    assert.equal(a.couleur, 'rouge');
    assert.equal(a.demandes_a_walid[0].statut, 'ouverte');
    // L'agent répète la même phrase : pas de doublon.
    await s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Walid doit choisir A ou D.', decision: 'Attendre.' });
    assert.equal(s.doc().tasks.find((x) => x.id === action).demandes.length, 1);
    // Outil explicite.
    assert.match(await s.tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Donner le nom d’auteur' }), /Demande enregistrée/);
  } finally {
    s.done();
  }
});

test('fermer une demande est une décision de Walid (relance) ; Telegram la signale', () => {
  const avant = JSON.stringify({ tasks: [{ id: 't', title: 'Livre 1', demandes: [{ id: 'd1', texte: 'Choisir A ou D', statut: 'ouverte' }] }] });
  const apres = JSON.stringify({ tasks: [{ id: 't', title: 'Livre 1', demandes: [{ id: 'd1', texte: 'Choisir A ou D', statut: 'faite', reponse: 'A' }] }] });
  assert.deepEqual(decisionsBetween(avant, apres), ['demande « Choisir A ou D » sur « Livre 1 » : faite (réponse de Walid : « A »)']);
  assert.match(describeEvent('demander_a_walid', { projet: 'ebook', demande: 'Choisir A ou D' }).line, /🔴 Demande à Walid \(ebook\) : Choisir A ou D/);
});

import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);

test('un agent dépose une image et la joint à sa demande ; l’adresse ne sert qu’une fois', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-depot-'));
  const db = openDb(dataDir);
  const server = createServer(createApp({ db, dataDir, passwordHash: hashPassword('a-b-c-d-e') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
    const action = (await tools.lire_projet.handler({ projet: 'ebook' })).actions[0].id;
    const { adresse } = await tools.preparer_depot.handler({ projet: 'ebook' });
    const chemin = new URL(adresse).pathname;
    const r = await fetch(base + chemin, { method: 'PUT', body: PNG, headers: { 'x-file-name': 'couverture-A.png' } });
    assert.equal(r.status, 201);
    const { fichier } = await r.json();
    assert.match(fichier, /^[a-f0-9]{24}$/);
    assert.equal((await fetch(base + chemin, { method: 'PUT', body: PNG })).status, 404, 'usage unique');
    assert.equal((await fetch(base + (await tools.preparer_depot.handler({ projet: 'ebook' })).adresse.replace(/^https:\/\/[^/]+/, ''), { method: 'PUT', body: Buffer.from('pas une image') })).status, 415);
    const msg = await tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Choisir la couverture A ou D', pieces: [{ titre: 'Couverture A', fichier }, { titre: 'Planche D', url: 'https://exemple.fr/d.png' }] });
    assert.match(msg, /avec 2 pièce\(s\)/);
    await assert.rejects(tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Autre', pieces: [{ titre: 'x', fichier: 'f'.repeat(24) }] }), /inconnu/);
    await assert.rejects(tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Autre', pieces: [{ titre: 'x', url: 'http://pas-https.fr' }] }), /https/);
    const d = JSON.parse(db.getDoc('project:ebook').value).tasks.find((t) => t.id === action).demandes[0];
    assert.equal(d.pieces[0].type, 'image/png');
    const id = d.id;
    assert.match(await tools.demander_a_walid.handler({ projet: 'ebook', action, demande_id: id, pieces: [{ titre: 'Couverture B', url: 'https://exemple.fr/b.png' }] }), /1 pièce\(s\) ajoutée/);
    assert.equal((await fetch(base + '/api/files/' + fichier)).status, 401, 'l’image ne se voit qu’en étant connecté');
  } finally {
    server.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Walid pose une question : la demande reste ouverte, l’agent répond, la relance porte la question', async () => {
  const s = setup();
  try {
    const action = (await s.tools.lire_projet.handler({ projet: 'ebook' })).actions[0].id;
    await s.tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Donner le nom d’auteur du livre 1' });
    const key = 'project:ebook';
    const avant = s.db.getDoc(key);
    const doc = JSON.parse(avant.value);
    const d = doc.tasks.find((x) => x.id === action).demandes[0];
    d.echanges = [{ de: 'walid', texte: 'Un nom pour tous mes livres, ou un par projet ?', at: '2026-11-09T05:00:00Z' }];
    d.attenteAgent = true;
    s.db.putDoc(key, JSON.stringify(doc), avant.version, 'walid');
    const decisions = decisionsBetween(avant.value, JSON.stringify(doc));
    assert.match(decisions[0], /question de Walid .* Un nom pour tous mes livres/);
    const lu = (await s.tools.lire_projet.handler({ projet: 'ebook' })).actions.find((x) => x.id === action).demandes_a_walid[0];
    assert.equal(lu.question_de_walid_a_repondre, 'Un nom pour tous mes livres, ou un par projet ?');
    assert.match(await s.tools.repondre_a_walid.handler({ projet: 'ebook', action, demande_id: lu.id, reponse: 'Je conseille un nom par grand thème.' }), /Réponse ajoutée/);
    const apres = (await s.tools.lire_projet.handler({ projet: 'ebook' })).actions.find((x) => x.id === action);
    assert.equal(apres.demandes_a_walid[0].statut, 'ouverte', 'Walid seul ferme la demande');
    assert.equal(apres.demandes_a_walid[0].question_de_walid_a_repondre, undefined);
    assert.equal(apres.demandes_a_walid[0].echanges.length, 2);
    assert.equal(apres.couleur, 'rouge');
    assert.equal(describeEvent('repondre_a_walid', { projet: 'ebook', reponse: 'Je conseille…' }), null, 'simple réponse : pas de Telegram');
    assert.match(describeEvent('repondre_a_walid', { projet: 'ebook', reponse: 'Il me faut ton choix.', bloque_sans_walid: true }).line, /ne peut pas avancer sans toi/);
  } finally {
    s.done();
  }
});

test('un blocage doit être expliqué ; Walid le lève ou abandonne l’idée, et l’agent le sait', async () => {
  const s = setup();
  try {
    const action = (await s.tools.lire_projet.handler({ projet: 'ebook' })).actions[0].id;
    await assert.rejects(s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Essai.', decision: 'Bloqué.', idees: [{ index: 0, erreur: 'Chrome déconnecté' }] }), /contexte/);
    await s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Essai.', decision: 'Bloqué.', idees: [{ index: 0, erreur: 'Chrome déconnecté', contexte: 'Je voulais lire les suggestions Amazon pour choisir les mots-clés ; ton Chrome est fermé.' }] });
    const i = (await s.tools.lire_projet.handler({ projet: 'ebook' })).actions.find((x) => x.id === action).idees[0];
    assert.equal(i.bloquee.ce_qui_bloque, 'Chrome déconnecté');
    assert.match(i.bloquee.contexte, /mots-clés/);
    // Une mise à jour d'idée sans erreur ne doit pas être refusée.
    await s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Suite.', decision: 'Attendre.', idees: [{ index: 0, commentaire: 'toujours bloqué' }] });
    const avant = JSON.stringify({ tasks: [{ id: 't', title: 'Fiche', ideas: [{ text: 'Suggestions Amazon', errorState: 'Chrome' }] }] });
    const leve = JSON.stringify({ tasks: [{ id: 't', title: 'Fiche', ideas: [{ text: 'Suggestions Amazon', unblockedAt: 'x' }] }] });
    const aband = JSON.stringify({ tasks: [{ id: 't', title: 'Fiche', ideas: [{ text: 'Suggestions Amazon', unblockedAt: 'x', dropped: true }] }] });
    assert.match(decisionsBetween(avant, leve)[0], /blocage levé par Walid .* réessaie/);
    assert.ok(decisionsBetween(avant, aband).some((d) => /abandonnée par Walid/.test(d)));
    assert.match(await s.tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Relire la fiche Amazon', pieces: [{ titre: 'Fiche Amazon', texte: 'Titre : …' }] }), /avec 1 pièce/);
  } finally {
    s.done();
  }
});

test('vidéo : dépôt au fil de l’eau, lecture par morceaux (Range), formats inconnus refusés', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-video-'));
  const db = openDb(dataDir);
  const server = createServer(createApp({ db, dataDir, passwordHash: hashPassword('mot-de-passe-video-1') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
    const depot = async () => new URL((await tools.preparer_depot.handler({ projet: 'ebook' })).adresse).pathname;
    // En-tête MP4 (« ftyp » à l'octet 4) + 2 Mo de contenu.
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2 * 1024 * 1024, 7)]);
    const r = await fetch(base + (await depot()), { method: 'PUT', body: mp4, headers: { 'x-file-name': 'episode.mp4' } });
    assert.equal(r.status, 201);
    const j = await r.json();
    assert.equal(j.type, 'video/mp4');
    assert.equal(j.taille, mp4.length);
    assert.equal((await fetch(base + (await depot()), { method: 'PUT', body: Buffer.from('rien de connu ici') })).status, 415);
    // Lecture connectée, par morceaux.
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'mot-de-passe-video-1' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const part = await fetch(base + '/api/files/' + j.fichier, { headers: { cookie, range: 'bytes=0-99' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 0-99/${mp4.length}`);
    assert.equal((await part.arrayBuffer()).byteLength, 100);
    const all = await fetch(base + '/api/files/' + j.fichier, { headers: { cookie } });
    assert.equal(all.status, 200);
    assert.equal(all.headers.get('accept-ranges'), 'bytes');
    assert.equal((await all.arrayBuffer()).byteLength, mp4.length);
    // Une image de plus de 10 Mo est refusée (seules les vidéos vont jusqu'à 300 Mo).
    const grosPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(11 * 1024 * 1024, 1)]);
    assert.equal((await fetch(base + (await depot()), { method: 'PUT', body: grosPng })).status, 413);
  } finally {
    server.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
