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
const saves = [];

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-test-'));
  db = openDb(dataDir);
  server = createServer(createApp({ db, dataDir, passwordHash: hashPassword(PASSWORD), onWalidSave: (...a) => saves.push(a) }));
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
  assert.equal(st.projects.length, 11);
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
  for (const n of ['lister_projets', 'lire_projet', 'ecrire_tour', 'proposer_action', 'proposer_modification', 'proposer_idee', 'noter_lecon', 'changer_statut_lecon', 'signaler_acces', 'factures_a_lire', 'lire_facture', 'enregistrer_facture', 'enregistrer_resultat', 'proposer_indicateur', 'enregistrer_indicateur', 'ecrire_bilan'])
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
    objectif_type: 'a_observer',
    seuil: { type: 'volume', valeur: 200, unite: 'fiches préparées' },
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
  assert.deepEqual(t.objective.threshold, { type: 'volume', value: 200, unit: 'fiches préparées' });
  assert.equal(t.objective.setBy, 'agent');
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

test('projet Gestion de Loop Agent : sa boucle propre en plus des 3 permanentes', async () => {
  const r = await call('lire_projet', { projet: 'gestion-loop-agent' });
  const ids = r.out.actions.map((a) => a.id);
  assert.ok(ids.includes('gestion-loop-agent-organisation'));
  assert.equal(ids.length, 4);
});

test('connecteur : objectif et résultats mesurés', async () => {
  // Sans type d'objectif : refusé.
  let r = await call('proposer_action', { projet: 'leviaro', titre: 'X', objectif: 'Y', type: 'Boucle', critere: 'Z', brief: BRIEF });
  assert.equal(r.isError, true);
  assert.match(r.out, /objectif_type/);
  // « À observer » sans seuil : refusé.
  r = await call('proposer_action', { projet: 'leviaro', titre: 'X', objectif: 'Y', type: 'Boucle', critere: 'Z', objectif_type: 'a_observer', brief: BRIEF });
  assert.equal(r.isError, true);

  // Objectif chiffré sur une boucle permanente déjà validée (posé par Walid).
  const doc = JSON.parse(db.getDoc('project:impacteur-mail').value);
  const v = db.getDoc('project:impacteur-mail').version;
  const t = doc.tasks.find((x) => x.id === 'impacteur-mail-stats');
  t.objective = { kind: 'chiffre', target: 40, unit: '% d’ouverture', direction: 'augmenter', setBy: 'walid' };
  assert.ok(db.putDoc('project:impacteur-mail', JSON.stringify(doc), v, 'walid').ok);

  // Résultat sans valeur ni « indisponible » : refusé (jamais 0 par défaut).
  r = await call('enregistrer_resultat', { projet: 'impacteur-mail', action: 'impacteur-mail-stats', d_ou: 'n8n' });
  assert.equal(r.isError, true);
  assert.match(r.out, /jamais 0/);

  r = await call('enregistrer_resultat', { projet: 'impacteur-mail', action: 'impacteur-mail-stats', valeur: 37, periode: 'semaine du 03/11', d_ou: 'n8n, 52 envois' });
  assert.equal(r.isError, false);
  assert.equal(r.out.avancement.ecart, 'il manque 3');
  r = await call('enregistrer_resultat', { projet: 'impacteur-mail', action: 'impacteur-mail-stats', indisponible: true, d_ou: 'n8n hors ligne' });
  assert.equal(r.isError, false);

  r = await call('lire_projet', { projet: 'impacteur-mail' });
  const a = r.out.actions.find((x) => x.id === 'impacteur-mail-stats');
  assert.equal(a.objectif_fixe.fixe_par, 'Walid');
  assert.equal(a.objectif_fixe.dernier_resultat, 37, 'une donnée indisponible ne remplace pas la dernière vraie mesure');
  assert.equal(a.resultats[0].valeur, 'indisponible');
  assert.equal(a.resultats[1].source, 'relevée par l’agent');

  // Seuil en volume : cumul, puis consigne de juger.
  r = await call('proposer_action', {
    projet: 'leviaro', titre: 'Secteur formation', objectif: 'Trouver des clients', type: 'Boucle', critere: 'Réponses',
    objectif_type: 'a_observer', seuil: { type: 'volume', valeur: 200, unite: 'mails envoyés' }, brief: BRIEF,
  });
  const id = r.out.action;
  const d2 = JSON.parse(db.getDoc('project:leviaro').value);
  const v2 = db.getDoc('project:leviaro').version;
  d2.tasks.find((x) => x.id === id).proposalStatus = 'approved';
  assert.ok(db.putDoc('project:leviaro', JSON.stringify(d2), v2, 'walid').ok);
  await call('enregistrer_resultat', { projet: 'leviaro', action: id, volume: 120, d_ou: 'Gmail envoyés' });
  r = await call('enregistrer_resultat', { projet: 'leviaro', action: id, volume: 90, d_ou: 'Gmail envoyés' });
  assert.equal(r.out.avancement.volume_cumule, 210);
  assert.equal(r.out.avancement.seuil_atteint, true);
  assert.match(r.out.avancement.consigne, /juge maintenant/);
});

test('connecteur : indicateurs clés, mesures et bilans', async () => {
  let r = await call('proposer_indicateur', { projet: 'nourmeet', nom: 'Inscrits', unite: 'inscrits', calcul: 'somme', pourquoi: 'Dit si le site attire.' });
  assert.equal(r.isError, false);
  const kpi = r.out.id;
  // Pas validé : pas de mesure.
  r = await call('enregistrer_indicateur', { projet: 'nourmeet', indicateur: kpi, valeur: 3, d_ou: 'admin' });
  assert.equal(r.isError, true);
  const doc = JSON.parse(db.getDoc('project:nourmeet').value);
  const v = db.getDoc('project:nourmeet').version;
  doc.kpis[0].status = 'valide';
  assert.ok(db.putDoc('project:nourmeet', JSON.stringify(doc), v, 'walid').ok);
  r = await call('enregistrer_indicateur', { projet: 'nourmeet', indicateur: kpi, d_ou: 'admin' });
  assert.match(r.out, /jamais 0/);
  r = await call('enregistrer_indicateur', { projet: 'nourmeet', indicateur: kpi, valeur: 3, d_ou: 'admin' });
  assert.equal(r.isError, false);
  r = await call('lire_projet', { projet: 'nourmeet' });
  assert.equal(r.out.indicateurs[0].semaine_en_cours, 3);
  assert.equal(r.out.indicateurs[0].semaine_precedente, 'indisponible');
  assert.equal(r.out.bilans_a_ecrire.length, 5);
  const due = r.out.bilans_a_ecrire[0];
  r = await call('ecrire_bilan', { projet: 'nourmeet', periode_type: 'semaine', periode: '2026-11', pourquoi: 'x' });
  assert.equal(r.isError, true, 'clé de mois pour une semaine : refusée');
  r = await call('ecrire_bilan', { projet: 'nourmeet', periode_type: due.periode_type, periode: due.periode, pourquoi: '3 inscrits, première semaine mesurée.', action_decisive: 'nourmeet-stats', action_decisive_texte: 'Le suivi a commencé.' });
  assert.equal(r.isError, false);
  r = await call('lire_projet', { projet: 'nourmeet' });
  assert.equal(r.out.bilans_a_ecrire.length, 4);
  assert.equal(r.out.derniers_bilans[0].action_decisive.title, 'Surveiller les statistiques');
});

test('action créée par Walid : un premier tour, puis attente de sa validation', async () => {
  const cur = db.getDoc('project:vegebudget');
  const doc = cur ? JSON.parse(cur.value) : { tasks: [], priorities: [], memories: [] };
  const v = cur ? cur.version : 0;
  doc.tasks.push({ id: 'walid-avatar', title: 'Avatar Instagram', origin: 'Walid', owner: 'Agent', type: 'Boucle', ideas: [] });
  assert.ok(db.putDoc('project:vegebudget', JSON.stringify(doc), v, 'walid').ok);

  let r = await call('lire_projet', { projet: 'vegebudget' });
  let a = r.out.actions.find((x) => x.id === 'walid-avatar');
  assert.equal(a.autonomie, 'première fois à valider');
  assert.match(a.premier_resultat, /fais-la tourner une première fois/);

  r = await call('ecrire_tour', { projet: 'vegebudget', action: 'walid-avatar', constat: '3 identités proposées.', decision: 'Attendre le choix de Walid.' });
  assert.equal(r.isError, false);
  assert.match(r.out, /Premier tour enregistré/);
  r = await call('ecrire_tour', { projet: 'vegebudget', action: 'walid-avatar', constat: 'a', decision: 'b' });
  assert.equal(r.isError, true, 'deuxième tour bloqué tant que Walid n’a pas validé');
  r = await call('lire_projet', { projet: 'vegebudget' });
  a = r.out.actions.find((x) => x.id === 'walid-avatar');
  assert.equal(a.couleur, 'rouge');
  assert.match(a.premier_resultat, /en attente/);

  // Walid valide : l'action tourne seule.
  const d2 = JSON.parse(db.getDoc('project:vegebudget').value);
  const t = d2.tasks.find((x) => x.id === 'walid-avatar');
  t.firstRunPending = false;
  t.autonomy = 'autonome';
  assert.ok(db.putDoc('project:vegebudget', JSON.stringify(d2), db.getDoc('project:vegebudget').version, 'walid').ok);
  r = await call('ecrire_tour', { projet: 'vegebudget', action: 'walid-avatar', constat: 'a', decision: 'b' });
  assert.equal(r.out, 'Tour enregistré sur « Avatar Instagram ».');
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

test('un enregistrement de Walid transmet l’ancienne et la nouvelle version (relance des agents)', async () => {
  const { cookie } = await login();
  const key = 'project:leviaro';
  const start = saves.length;
  const v1 = JSON.stringify({ tasks: [{ id: 't1', proposalStatus: 'pending' }] });
  const v2 = JSON.stringify({ tasks: [{ id: 't1', proposalStatus: 'approved' }] });
  const cur = await (await fetch(base + '/api/docs/' + encodeURIComponent(key), { headers: { Cookie: cookie } })).json();
  const r1 = await put(cookie, key, v1, cur.version);
  const { version } = await r1.json();
  await put(cookie, key, v2, version);
  const mine = saves.slice(start).filter((s) => s[0] === key);
  assert.equal(mine.length, 2);
    assert.equal(mine[1][1], v1);
  assert.equal(mine[1][2], v2);
});
