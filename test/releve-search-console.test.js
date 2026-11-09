import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { projetDuSite, appliquer, jwt } from '../server/releve-search-console.js';

test('Search Console : sites reconnus, indicateurs remplis, demande d’accès fermée', () => {
  assert.equal(projetDuSite('sc-domain:vegebudget.fr'), 'vegebudget');
  assert.equal(projetDuSite('https://www.leviaro.fr/'), 'leviaro');
  assert.equal(projetDuSite('https://autre.fr/'), null);
  const doc = { kpis: [{ id: 'k-g', name: 'Visites venues de Google', status: 'valide' }], kpiValues: [{ kpi: 'k-g', date: '2026-11-05', value: 99, source: 'agent' }], tasks: [{ id: 't', ideas: [{ id: 'i', accessRequests: [{ name: 'Google Search Console — vegebudget.fr (lecture seule)', connected: false }] }] }] };
  appliquer(doc, { site: 'sc-domain:vegebudget.fr', parJour: [{ date: '2026-11-05', clics: 3, affichages: 120, position: 14.2 }], sur28jours: { clics: 3, affichages: 120 }, requetes: [], pages: [] }, '2026-11-09T20:00:00Z');
  assert.equal(doc.kpiValues.filter((v) => v.kpi === 'k-g' && v.date === '2026-11-05').length, 1);
  assert.equal(doc.kpiValues.find((v) => v.kpi === 'k-g').value, 3);
  assert.ok(doc.kpis.some((k) => k.name === 'Affichages dans Google'));
  assert.ok(!doc.kpis.some((k) => k.name === 'Clics depuis Google'));
  assert.equal(doc.tasks[0].ideas[0].accessRequests[0].connected, true);
});

test('Search Console : le jeton est signé avec la clé du compte de service', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const t = jwt({ client_email: 'a@b.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, 1000);
  const [h, c, sig] = t.split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).scope, 'https://www.googleapis.com/auth/webmasters.readonly');
});
