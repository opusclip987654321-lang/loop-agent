import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireMembres, appliquer, createRelevePatreon } from '../server/releve-patreon.js';

const page = { data: [
  { attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 500, pledge_relationship_start: '2026-11-08T10:00:00+00:00', full_name: 'Ali' } },
  { attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 300, pledge_relationship_start: '2026-10-01T10:00:00+00:00' } },
  { attributes: { patron_status: 'former_patron', currently_entitled_amount_cents: 0, pledge_relationship_start: '2026-11-08T10:00:00+00:00' } },
] };
const kpis = [
  { id: 'k-new', name: 'Nouveaux membres Patreon', agg: 'somme', status: 'valide' },
  { id: 'k-rev', name: 'Revenus Patreon du mois', agg: 'dernier', status: 'valide' },
];

test('membres actifs, revenus du mois et arrivées par jour, sans nom', () => {
  const lu = lireMembres([page]);
  assert.equal(lu.actifs, 2);
  assert.equal(lu.revenusMois, 8);
  assert.deepEqual(lu.arrivees, { '2026-11-08': 1, '2026-10-01': 1 });
  const doc = { kpis, kpiValues: [] };
  appliquer(doc, lu, '2026-11-09', '2026-11-09T10:00:00Z');
  const v = (k, d) => (doc.kpiValues.find((x) => x.kpi === k && x.date === d) || {}).value;
  assert.equal(v('k-new', '2026-11-08'), 1);
  assert.equal(v('k-new', '2026-11-09'), 0);
  assert.equal(v('k-rev', '2026-11-09'), 8);
  assert.ok(!JSON.stringify(doc).includes('Ali'));
});

test('clé expirée : renouvelée toute seule, puis lecture', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-patreon-'));
  try {
    writeFileSync(join(dataDir, 'patreon.json'), JSON.stringify({ client_id: 'id12345678', client_secret: 'sec12345678', access_token: 'vieux', refresh_token: 'refresh123' }));
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push(url);
      if (url.endsWith('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'neuf', refresh_token: 'refresh456', expires_in: 2592000 }) };
      if (opts.headers.authorization === 'Bearer vieux') return { ok: false, status: 401, json: async () => ({}) };
      if (url.includes('/members')) return { ok: true, status: 200, json: async () => page };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: '123' }] }) };
    };
    const db = { getDoc: () => ({ value: JSON.stringify({ kpis, kpiValues: [] }), version: 1 }), putDoc: () => ({ ok: true }) };
    const r = await createRelevePatreon({ db, dataDir, fetchImpl }).tick();
    assert.equal(r.actifs, 2);
    const saved = JSON.parse(readFileSync(join(dataDir, 'patreon.json'), 'utf8'));
    assert.equal(saved.access_token, 'neuf');
    assert.equal(saved.refresh_token, 'refresh456');
    assert.ok(calls.some((u) => u.endsWith('/token')));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
