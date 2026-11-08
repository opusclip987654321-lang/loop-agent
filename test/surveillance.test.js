import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { checkSite, certLevel, diskLevel, transition, createSurveillance } from '../server/surveillance.js';

const res = (status, body) => ({ status, json: async () => body });

test('un site : ok, erreur, json qui signale un problème, statuts admis', async () => {
  assert.equal((await checkSite({ url: 'u' }, { fetchImpl: async () => res(200) })).niveau, 'ok');
  assert.equal((await checkSite({ url: 'u' }, { fetchImpl: async () => res(502) })).niveau, 'panne');
  assert.equal((await checkSite({ url: 'u', json: { status: 'ok' } }, { fetchImpl: async () => res(200, { status: 'ko' }) })).niveau, 'panne');
  assert.equal((await checkSite({ url: 'u', statuts: [401] }, { fetchImpl: async () => res(401) })).niveau, 'ok');
  assert.equal((await checkSite({ url: 'u' }, { fetchImpl: async () => { throw new Error('x'); } })).niveau, 'panne');
  let t = 0;
  const slow = await checkSite({ url: 'u' }, { fetchImpl: async () => ((t += 5000), res(200)), now: () => t });
  assert.equal(slow.niveau, 'attention');
});

test('certificats et disque : seuils du cerveau', () => {
  assert.equal(certLevel({ jours: 60 }).niveau, 'ok');
  assert.equal(certLevel({ jours: 10 }).niveau, 'attention');
  assert.equal(certLevel({ jours: 2 }).niveau, 'panne');
  assert.equal(certLevel({ erreur: 'injoignable' }).niveau, 'panne');
  assert.equal(diskLevel(50).niveau, 'ok');
  assert.equal(diskLevel(86).niveau, 'attention');
  assert.equal(diskLevel(96).niveau, 'panne');
});

test('une seule alerte par panne, puis « rétabli » avec la durée', () => {
  const s = {};
  assert.equal(transition(s, 'k', 'Site', { niveau: 'ok' }, 0), null);
  assert.match(transition(s, 'k', 'Site', { niveau: 'panne', detail: 'répond 502' }, 1000), /🔴 Panne : Site — répond 502/);
  assert.equal(transition(s, 'k', 'Site', { niveau: 'panne', detail: 'répond 502' }, 2000), null);
  assert.match(transition(s, 'k', 'Site', { niveau: 'ok' }, 1000 + 25 * 60000), /🟢 Rétabli : Site \(après 25 min\)/);
});

function fakeTls(days) {
  return (opts, cb) => {
    const sock = new EventEmitter();
    sock.getPeerCertificate = () => ({ valid_to: new Date(Date.now() + days * 86400000).toUTCString() });
    sock.destroy = () => {};
    setImmediate(cb);
    return sock;
  };
}

test('un tour complet : revérifie avant d’alerter, garde l’état sur disque, un seul message groupé', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-surv-'));
  try {
    const notes = [];
    let down = true;
    let calls = 0;
    const s = createSurveillance({
      dataDir,
      sites: [{ id: 'a', nom: 'Site A', url: 'a' }, { id: 'b', nom: 'Site B', url: 'b' }],
      certificats: ['a.fr'],
      fetchImpl: async (url) => (calls++, url === 'a' && down ? res(502) : res(200)),
      connectImpl: fakeTls(60),
      statfsImpl: async () => ({ blocks: 100, bavail: 40 }),
      sleep: async () => {},
      notify: async (t) => notes.push(t),
      log: { error() {} },
    });
    await s.tick();
    assert.equal(calls, 3, 'le site en panne est revérifié une fois');
    assert.equal(notes.length, 1);
    assert.match(notes[0], /🔴 Panne : Site A/);
    assert.doesNotMatch(notes[0], /Site B/);
    await s.tick();
    assert.equal(notes.length, 1, 'pas de répétition tant que la panne dure');
    down = false;
    await s.tick();
    assert.match(notes[1], /🟢 Rétabli : Site A/);
    const saved = JSON.parse(readFileSync(join(dataDir, 'surveillance.json'), 'utf8'));
    assert.equal(saved['site:a'].niveau, 'ok');
    assert.equal(saved['disque'].niveau, 'ok');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
