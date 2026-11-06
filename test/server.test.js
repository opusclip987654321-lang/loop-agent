import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword, verifyPassword } from '../server/auth.js';

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
  assert.equal(st.projects.length, 8);
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
