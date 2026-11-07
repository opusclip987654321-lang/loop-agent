import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword, verifyPassword, tokenHash } from '../server/auth.js';

const PASSWORD = 'mot-de-passe-de-test-123';
let server, base, dataDir, db;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-test-'));
  db = openDb(dataDir);
  server = createServer(createApp({ db, dataDir, passwordHash: hashPassword(PASSWORD) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function login(password = PASSWORD) {
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie };
}

function put(cookie, key, value, baseVersion) {
  return fetch(base + '/api/docs/' + encodeURIComponent(key), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ value, base: baseVersion }),
  });
}

test('empreinte du mot de passe : bon et mauvais mot de passe', () => {
  const h = hashPassword('abc-def-ghi-jkl');
  assert.ok(!h.includes('$'), 'pas de $ (Docker Compose les interpréterait)');
  assert.equal(verifyPassword('abc-def-ghi-jkl', h), true);
  assert.equal(verifyPassword('autre', h), false);
  assert.equal(verifyPassword('abc-def-ghi-jkl', 'n’importe quoi'), false);
});

test('healthz répond sans connexion', async () => {
  const r = await fetch(base + '/healthz');
  assert.equal(r.status, 200);
});

test('sans connexion : la page renvoie vers /login et l’API refuse', async () => {
  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login');
  const api = await fetch(base + '/api/state');
  assert.equal(api.status, 401);
  const js = await fetch(base + '/app.js');
  assert.equal(js.status, 401);
  const loginPage = await fetch(base + '/login');
  assert.equal(loginPage.status, 200);
});

test('mauvais mot de passe refusé', async () => {
  const { r } = await login('faux');
  assert.equal(r.status, 401);
});

test('connexion, état, écriture versionnée et conflit', async () => {
  const { r, cookie } = await login();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);

  const st = await (await fetch(base + '/api/state', { headers: { Cookie: cookie } })).json();
  assert.equal(st.projects.length, 9);
  assert.ok(st.projects.some((p) => p.id === 'impacteur-communaute'));
  assert.deepEqual(st.docs, {});

  // Création (base 0), puis mise à jour (base 1).
  let w = await put(cookie, 'project:leviaro', JSON.stringify({ tasks: [] }), 0);
  assert.equal(w.status, 200);
  assert.equal((await w.json()).version, 1);
  w = await put(cookie, 'project:leviaro', JSON.stringify({ tasks: [{ id: 'a' }] }), 1);
  assert.equal((await w.json()).version, 2);

  // Écriture sur une version périmée : refusée, avec la version actuelle.
  w = await put(cookie, 'project:leviaro', JSON.stringify({ tasks: [] }), 1);
  assert.equal(w.status, 409);
  const c = await w.json();
  assert.equal(c.version, 2);
  assert.deepEqual(JSON.parse(c.value), { tasks: [{ id: 'a' }] });

  const v = await (await fetch(base + '/api/versions', { headers: { Cookie: cookie } })).json();
  assert.equal(v['project:leviaro'], 2);
});

test('clés et contenus refusés', async () => {
  const { cookie } = await login();
  assert.equal((await put(cookie, 'project:inconnu', '{}', 0)).status, 404);
  assert.equal((await put(cookie, 'project:leviaro', 'pas du json', 0)).status, 400);
  assert.equal((await put(cookie, 'project:leviaro', '[1,2]', 0)).status, 400);
});

test('écriture refusée depuis un autre site', async () => {
  const { cookie } = await login();
  const r = await fetch(base + '/api/docs/money', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
    body: JSON.stringify({ value: '{}', base: 0 }),
  });
  assert.equal(r.status, 403);
});

test('factures : dépôt PDF, lecture, suppression ; format inconnu refusé', async () => {
  const { cookie } = await login();
  const pdf = Buffer.from('%PDF-1.4\n% test\n');
  let r = await fetch(base + '/api/files', {
    method: 'POST',
    headers: { Cookie: cookie, 'X-File-Name': encodeURIComponent('facture ovh.pdf') },
    body: pdf,
  });
  assert.equal(r.status, 201);
  const f = await r.json();
  assert.equal(f.mime, 'application/pdf');
  assert.equal(f.name, 'facture ovh.pdf');

  r = await fetch(base + '/api/files/' + f.id, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf);

  r = await fetch(base + '/api/files/' + f.id, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  r = await fetch(base + '/api/files/' + f.id, { headers: { Cookie: cookie } });
  assert.equal(r.status, 404);

  r = await fetch(base + '/api/files', { method: 'POST', headers: { Cookie: cookie }, body: '<html>' });
  assert.equal(r.status, 415);
});

test('déconnexion : la session ne marche plus', async () => {
  const { cookie } = await login();
  const r = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const st = await fetch(base + '/api/state', { headers: { Cookie: cookie } });
  assert.equal(st.status, 401);
});

test('chemins de fichiers : pas de sortie du dossier public', async () => {
  const { cookie } = await login();
  for (const p of ['/../server/auth.js', '/%2e%2e/package.json', '/.env']) {
    const r = await fetch(base + p, { headers: { Cookie: cookie } });
    assert.notEqual(r.status, 200, p);
  }
});

// ---------- Connecteur des agents (/mcp) ----------
const AGENT_KEY = 'la_cle-de-test-agent';
let rpcId = 0;

async function mcp(method, params, key = AGENT_KEY) {
  const r = await fetch(base + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: r.status, json: r.status === 202 ? null : await r.json() };
}
async function call(name, args) {
  const r = await mcp('tools/call', { name, arguments: args });
  const res = r.json.result;
  const t = res.content[0].text;
  let parsed = t;
  try {
    parsed = JSON.parse(t);
  } catch {}
  return { isError: res.isError, out: parsed, raw: res };
}
const BRIEF = {
  observe: '61 % des fiches sans adresse sur 120 préparées (30 derniers jours).',
  deduction: 'La recherche gratuite rate les auteurs auto-édités (hypothèse).',
  proposition: 'Ajouter la recherche sur le site de l’éditeur, sur imp-envois, dès demain.',
  effet: '+20 adresses par semaine attendues, 10 min par tour, 0 €.',
  si_rien: 'Le plafond d’envoi reste inutilisé ; sous 2 semaines la file se vide.',
};

test('connecteur : sans clé ou mauvaise clé → 401', async () => {
  db.addAgentKey('cle-test', 'test', tokenHash(AGENT_KEY));
  assert.equal((await mcp('tools/list', {}, null)).status, 401);
  assert.equal((await mcp('tools/list', {}, 'la_faux')).status, 401);
  assert.equal((await fetch(base + '/mcp')).status, 405);
  assert.equal((await fetch(base + '/.well-known/oauth-protected-resource')).status, 404);
});

test('connecteur : initialize et liste des outils', async () => {
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.json.result.serverInfo.name, 'loop-agent');
  assert.match(init.json.result.instructions, /ne commande JAMAIS rien/);
  const tools = (await mcp('tools/list', {})).json.result.tools.map((t) => t.name);
  for (const n of ['lister_projets', 'lire_projet', 'ecrire_tour', 'proposer_action', 'proposer_modification', 'proposer_idee', 'noter_lecon', 'changer_statut_lecon', 'signaler_acces', 'factures_a_lire', 'lire_facture', 'enregistrer_facture'])
    assert.ok(tools.includes(n), n);
});

test('connecteur : un tour complet sur un projet jamais ouvert', async () => {
  let r = await call('lire_projet', { projet: 'impacteur-mail' });
  assert.equal(r.out.actions.length, 3, '3 boucles permanentes par défaut');

  // Proposition sans les 5 points : refusée.
  r = await call('proposer_action', { projet: 'impacteur-mail', titre: 'X', objectif: 'Y', type: 'Boucle', critere: 'Z', brief: { observe: 'a' } });
  assert.equal(r.isError, true);
  assert.match(r.out, /obligatoire/);

  r = await call('proposer_action', {
    projet: 'impacteur-mail',
    titre: 'Chercher les adresses chez l’éditeur',
    objectif: 'Trouver plus d’adresses',
    type: 'Boucle',
    critere: 'Fiches avec adresse',
    idees: ['Lister les éditeurs', 'Tester 20 fiches'],
    brief: BRIEF,
  });
  assert.equal(r.isError, false);
  const newId = r.out.action;

  // Elle attend Walid : impossible de la faire tourner.
  r = await call('ecrire_tour', { projet: 'impacteur-mail', action: newId, constat: 'a', decision: 'b' });
  assert.equal(r.isError, true);
  assert.match(r.out, /validation de Walid/);

  // Le document est bien celui que lit l’interface : action rouge, en attente.
  const doc = JSON.parse(db.getDoc('project:impacteur-mail').value);
  const t = doc.tasks.find((x) => x.id === newId);
  assert.equal(t.proposalStatus, 'pending');
  assert.equal(t.brief.ifNothing, BRIEF.si_rien);
  assert.ok(doc.priorities.includes(newId));

  // Tour sur une boucle permanente + idée qui avance.
  r = await call('ecrire_tour', {
    projet: 'impacteur-mail',
    action: 'impacteur-mail-stats',
    constat: '7 jours : 52 envois, 19 ouvertures (37 %).',
    decision: 'Garder l’objet actuel une semaine de plus.',
    idees: [{ index: 0, stade: 'Exécution', commentaire: 'Relevé fait.' }],
  });
  assert.equal(r.isError, false);
  r = await call('noter_lecon', {
    projet: 'impacteur-mail',
    action: 'impacteur-mail-stats',
    type: 'Réussites',
    titre: 'Objet court',
    texte: '37 % d’ouverture sur 52 envois avec un objet de moins de 6 mots.',
    lecon: 'Garder des objets courts.',
  });
  const lessonId = r.out.id;
  r = await call('changer_statut_lecon', { projet: 'impacteur-mail', lecon: lessonId, statut: 'confirmée', raison: '41 % sur 120 envois.' });
  assert.equal(r.isError, false);
  r = await call('signaler_acces', { projet: 'impacteur-mail', action: 'impacteur-mail-mails', idee: 0, outil: 'Gmail — Frexit', message: 'Pour lire les réponses.' });
  assert.equal(r.isError, false);

  r = await call('lire_projet', { projet: 'impacteur-mail' });
  const stats = r.out.actions.find((a) => a.id === 'impacteur-mail-stats');
  assert.equal(stats.idees[0].stade, 'Exécution');
  assert.equal(stats.derniers_tours[0].aiDecision, 'Garder l’objet actuel une semaine de plus.');
  assert.equal(r.out.memoire.find((m) => m.id === lessonId).statut, 'confirmée');
  assert.equal(r.out.actions.find((a) => a.id === 'impacteur-mail-mails').couleur, 'rouge');

  // Modification : l’action s’arrête.
  r = await call('proposer_modification', { projet: 'impacteur-mail', action: 'impacteur-mail-veille', brief: BRIEF });
  assert.equal(r.isError, false);
  r = await call('ecrire_tour', { projet: 'impacteur-mail', action: 'impacteur-mail-veille', constat: 'a', decision: 'b' });
  assert.equal(r.isError, true);

  const list = (await call('lister_projets', {})).out;
  assert.equal(list.find((p) => p.projet === 'impacteur-mail').couleur, 'rouge');
  assert.equal(list.find((p) => p.projet === 'extrait-politique').couleur, 'gris');
});

test('connecteur : lecture d’une facture déposée', async () => {
  const { cookie } = await login();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const up = await (await fetch(base + '/api/files', { method: 'POST', headers: { Cookie: cookie, 'X-File-Name': 'ovh.png' }, body: png })).json();
  const cur = await (await fetch(base + '/api/docs/money', { headers: { Cookie: cookie } })).json();
  const money = { expenses: [{ id: 'e1', name: 'VPS YouTube (OVH)', amount: 12, cur: '€', freq: 'mois', project: 'Commun (plusieurs projets)' }], invoices: [{ id: 'f1', file: 'ovh.png', fileId: up.id, state: 'lecture' }], corrections: [], ai: [] };
  await put(cookie, 'money', JSON.stringify(money), cur.version);

  let r = await call('factures_a_lire', {});
  assert.equal(r.out.factures[0].id, 'f1');
  r = await call('lire_facture', { id: 'f1' });
  assert.equal(r.raw.content[0].type, 'image');
  r = await call('enregistrer_facture', { id: 'f1', etat: 'lue', fournisseur: 'OVH', montant: 12, devise: '€', date: '2026-11-01', correspond_a: 'VPS YouTube (OVH)' });
  assert.equal(r.isError, false);
  const after = JSON.parse(db.getDoc('money').value);
  assert.equal(after.invoices[0].state, 'lue');
  assert.equal(after.expenses[0].invoice.date, '2026-11-01');
});
