import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifierJour, createNourVeille } from '../server/nour-veille.js';

const jour = '2026-11-09';
const rel = (s) => ({ jours: { [jour]: s } });

test('les trois problèmes et le cas normal', () => {
  assert.equal(verifierJour({ jours: {} }, 3, jour).ok, true, 'relevé absent : pas d’alerte (choix de Walid)');
  assert.match(verifierJour(rel({ premiers: 0, relances: 0, echecs: 4, versions: {} }), 3, jour).texte, /aucun mail .* 4 échec/);
  assert.match(verifierJour(rel({ premiers: 10, relances: 5, versions: { v1: 15 } }), 3, jour).texte, /15 mail\(s\) en v1 .* la v3/);
  const ok = verifierJour(rel({ premiers: 11, relances: 13, versions: { v3: 24 } }), 3, jour);
  assert.equal(ok.ok, true);
  assert.match(ok.texte, /11 premier.* 13 relance.* v3/);
  assert.equal(verifierJour(rel({ premiers: 0, relances: 0, versions: {} }), 3, jour).ok, false);
});

test('une fois par jour, après 11 h ; un message seulement en cas de problème', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-veille-'));
  try {
    writeFileSync(join(dataDir, 'nour-methode.json'), JSON.stringify({ secret: 'x', methode: { version: 3 } }));
    let releve = rel({ premiers: 11, relances: 13, versions: { v3: 24 } });
    const db = { getDoc: () => ({ value: JSON.stringify({ releveN8n: releve }) }) };
    let t = Date.parse('2026-11-09T08:00:00Z'); // 9 h à Paris
    const notes = [];
    const v = createNourVeille({ db, dataDir, now: () => t, notify: async (m) => notes.push(m) });
    assert.equal(await v.tick(), null, 'trop tôt');
    t = Date.parse('2026-11-09T10:30:00Z');
    await v.tick();
    assert.equal(notes.length, 0, 'jour normal : pas de message');
    t = Date.parse('2026-11-10T10:30:00Z');
    releve = { jours: {} };
    await v.tick();
    assert.equal(notes.length, 0, 'relevé absent : pas de message');
    t = Date.parse('2026-11-11T10:30:00Z');
    releve = { jours: { '2026-11-11': { premiers: 6, relances: 2, versions: { v1: 8 } } } };
    await v.tick();
    await v.tick();
    assert.equal(notes.length, 1, 'une seule alerte par jour');
    assert.match(notes[0], /8 mail\(s\) en v1/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
