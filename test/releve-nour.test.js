import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { nettoyer, appliquer } from '../server/releve-nour.js';

const kpis = [
  { id: 'k-contact', name: 'Restaurants contactés', agg: 'somme', status: 'valide' },
  { id: 'k-ouv', name: "Taux d'ouverture des mails", agg: 'dernier', status: 'valide' },
  { id: 'k-int', name: 'Réponses intéressées', agg: 'somme', status: 'valide' },
];
const releve = { jours: { '2026-11-07': { premiers: 12, relances: 30, echecs: 1, ouvertures: 9, reponses: 2, decouverts: 40, versions: { v3: 42 } } }, glissant7: { envoyes: 200, ouverts: 50 } };

test('seuls des nombres entrent ; noms et textes sont rejetés', () => {
  const r = nettoyer({ jours: { '2026-11-07': { premiers: '12', nom: 'Chez Ali', versions: { v3: 4, 'chez ali': 2 } }, 'pas-une-date': { premiers: 1 } }, glissant7: { envoyes: 5, ouverts: 'x' } });
  assert.deepEqual(Object.keys(r.jours), ['2026-11-07']);
  assert.equal(r.jours['2026-11-07'].premiers, 12);
  assert.equal(r.jours['2026-11-07'].nom, undefined);
  assert.deepEqual(r.jours['2026-11-07'].versions, { v3: 4 });
  assert.equal(r.glissant7.ouverts, null);
  assert.throws(() => nettoyer({}));
});

test('remplit les indicateurs ; un nouveau relevé du même jour remplace l’ancien (pas de double compte)', () => {
  const doc = { kpis, kpiValues: [{ id: 'a', kpi: 'k-contact', date: '2026-11-07', source: 'agent', value: 8 }] };
  appliquer(doc, nettoyer(releve), '2026-11-07T10:00:00Z');
  appliquer(doc, nettoyer({ ...releve, jours: { '2026-11-07': { ...releve.jours['2026-11-07'], premiers: 15 } } }), '2026-11-07T11:00:00Z');
  const contact = doc.kpiValues.filter((v) => v.kpi === 'k-contact' && v.source === 'releve-n8n');
  assert.equal(contact.length, 1);
  assert.equal(contact[0].value, 15);
  assert.equal(doc.kpiValues.find((v) => v.source === 'agent').value, 8, 'la valeur de l’agent n’est pas touchée');
  assert.equal(doc.kpiValues.find((v) => v.kpi === 'k-ouv').value, 25);
  assert.equal(doc.kpiValues.some((v) => v.kpi === 'k-int'), false, 'les réponses intéressées demandent un tri : pas remplies ici');
  assert.equal(doc.releveN8n.jours['2026-11-07'].relances, 30);
});

let dataDir, db, server, base;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-releve-'));
  db = openDb(dataDir);
  db.putDoc('project:nourmeet', JSON.stringify({ tasks: [], kpis }), 0, 'test');
  server = createServer(createApp({ db, dataDir, passwordHash: hashPassword('x-y-z-w-v') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('route : refuse sans jeton, accepte avec, écrit dans le projet nourmeet', async () => {
  const post = (jeton, body) => fetch(base + '/releve/nour-meet', { method: 'POST', headers: { 'content-type': 'application/json', ...(jeton ? { authorization: 'Bearer ' + jeton } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post(null, releve)).status, 401);
  const jeton = execFileSync('node', ['scripts/releve-jeton.js', 'creer'], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' }).trim();
  assert.match(jeton, /^rn_/);
  assert.equal((await post('rn_faux', releve)).status, 401);
  const r = await post(jeton, releve);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ecrits.length, 2);
  const doc = JSON.parse(db.getDoc('project:nourmeet').value);
  assert.equal(doc.kpiValues.find((v) => v.kpi === 'k-contact').value, 12);
  assert.equal((await fetch(base + '/releve/nour-meet')).status, 405);
});
