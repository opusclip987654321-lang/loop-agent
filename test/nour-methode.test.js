import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { charger, verifier } from '../server/nour-methode.js';

const texte = (o) => ({ objet: o, corps: 'Bonjour {nom}, … {lien}\n{pied}' });
const methode = { version: 4, textes: { initial: texte('Vos clients halal'), relance1: texte('Relance'), relance2: texte('Dernier message') }, recherches: ['restaurant halal paris'], relanceJours: [4, 9], parJour: 30 };

let dataDir, db, server, base;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-nour-'));
  db = openDb(dataDir);
  server = createServer(createApp({ db, dataDir, passwordHash: hashPassword('x-y-z-w-v') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const script = (args, input) => execFileSync('node', ['scripts/nour-methode.js', ...args], { env: { ...process.env, DATA_DIR: dataDir }, input, encoding: 'utf8' });

test('contrôle d’une méthode', () => {
  assert.deepEqual(verifier(methode), []);
  assert.ok(verifier({ ...methode, parJour: 200 }).length);
  assert.ok(verifier({ ...methode, textes: { ...methode.textes, initial: { objet: 'x', corps: 'sans lien' } } }).length);
  assert.ok(verifier({ ...methode, textes: { ...methode.textes, initial: { objet: 'a@b.fr', corps: '{lien}{pied}' } } }).length);
});

test('import, puis n8n lit la méthode à l’adresse secrète, au format du cerveau', async () => {
  assert.equal((await fetch(base + '/loop/nour-meet/' + 'a'.repeat(32))).status, 404, 'rien avant l’import');
  assert.match(script(['importer'], JSON.stringify({ methode, pause: false })), /v4 importée/);
  assert.equal((statSync(join(dataDir, 'nour-methode.json')).mode & 0o777).toString(8), '600');
  const adresse = script(['adresse']).trim();
  const chemin = new URL(adresse).pathname;
  const r = await fetch(base + chemin);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { ...methode, pause: false });
  assert.equal((await fetch(base + '/loop/nour-meet/' + 'b'.repeat(32))).status, 404, 'mauvaise adresse');
  assert.match(script(['voir']), /version 4 · 30 mails\/jour · relances à 4 et 9 jours/);
  assert.doesNotMatch(script(['voir']), new RegExp(charger(dataDir).secret), 'voir ne montre pas le secret');
});

test('une méthode incomplète est refusée, la précédente reste servie ; retour en arrière possible', async () => {
  assert.throws(() => script(['importer'], JSON.stringify({ methode: { version: 5 } })));
  assert.equal(charger(dataDir).methode.version, 4);
  script(['importer'], JSON.stringify({ methode: { ...methode, version: 5 }, pause: true }));
  assert.equal(charger(dataDir).methode.version, 5);
  assert.match(script(['revenir', 'v4']), /revenue à la v4/);
  const r = await fetch(base + new URL(script(['adresse']).trim()).pathname);
  assert.equal((await r.json()).version, 4);
});
