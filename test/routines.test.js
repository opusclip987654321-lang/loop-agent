import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionsBetween, createRoutineRelay } from '../server/routines.js';

const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_abc123/fire';
const ROUTINES = { leviaro: { url: URL_OK, token: 'sk-ant-oat01-test' } };
const doc = (tasks, kpis = []) => JSON.stringify({ tasks, kpis });

test('repère les décisions de Walid, pas les simples modifications', () => {
  const before = doc(
    [
      { id: 't1', title: 'Mail A/B', proposalStatus: 'pending' },
      { id: 't2', title: 'Veille', firstRunPending: true },
      { id: 't3', title: 'Stats', ideas: [{ id: 'i1', text: 'Tester un objet court', approvalStatus: 'pending' }] },
      { id: 't4', title: 'Lire', paused: true },
    ],
    [{ id: 'k1', name: 'Réponses', status: 'propose' }],
  );
  const after = doc(
    [
      { id: 't1', title: 'Mail A/B', proposalStatus: 'approved' },
      { id: 't2', title: 'Veille', firstRunPending: false },
      { id: 't3', title: 'Stats', ideas: [{ id: 'i1', text: 'Tester un objet court', approvalStatus: 'approved', walidReply: 'Oui, essaie' }] },
      { id: 't4', title: 'Lire', paused: false },
      { id: 't5', title: 'Nouvelle', origin: 'Walid' },
    ],
    [{ id: 'k1', name: 'Réponses', status: 'valide' }],
  );
  const d = decisionsBetween(before, after);
  assert.equal(d.length, 7);
  assert.ok(d.some((x) => x.includes('Mail A/B') && x.includes('validée')));
  assert.ok(d.some((x) => x.includes('premier résultat')));
  assert.ok(d.some((x) => x.includes('réponse de Walid')));
  assert.ok(d.some((x) => x.includes('indicateur')));
  assert.ok(d.some((x) => x.includes('Nouvelle')));
  // Un simple changement de texte ne relance rien.
  assert.deepEqual(decisionsBetween(doc([{ id: 't1', title: 'A' }]), doc([{ id: 't1', title: 'B' }])), []);
});

function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => '120' },
      json: async () => ({ type: 'routine_fire', claude_code_session_url: 'https://claude.ai/code/session_x' }),
    };
  };
  fn.calls = calls;
  return fn;
}
const approve = [doc([{ id: 't1', title: 'Mail', proposalStatus: 'pending' }]), doc([{ id: 't1', title: 'Mail', proposalStatus: 'approved' }])];
const approve2 = [doc([{ id: 't2', title: 'Veille', firstRunPending: true }]), doc([{ id: 't2', title: 'Veille', firstRunPending: false }])];

test('lance la routine du projet, puis attend 30 minutes avant la suivante sans perdre la décision', async () => {
  let clock = 1_000_000;
  const fetchImpl = fakeFetch();
  const notes = [];
  const r = createRoutineRelay({ routines: ROUTINES, fetchImpl, now: () => clock, notify: async (t) => notes.push(t), log: { log() {}, error() {} } });
  r.onWalidSave('project:leviaro', ...approve);
  await r.tick();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, URL_OK);
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, 'Bearer sk-ant-oat01-test');
  assert.match(JSON.parse(fetchImpl.calls[0].opts.body).text, /proposition « Mail » : validée/);
  assert.match(notes[0], /relancé/);

  clock += 10 * 60 * 1000; // 10 min plus tard : nouvelle décision, mais garde-fou
  r.onWalidSave('project:leviaro', ...approve2);
  await r.tick();
  assert.equal(fetchImpl.calls.length, 1);

  clock += 21 * 60 * 1000; // 31 min après le premier lancement
  await r.tick();
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(JSON.parse(fetchImpl.calls[1].opts.body).text, /premier résultat de « Veille »/);
});

test('ne lance rien pour un projet sans routine, ni pour une écriture sans décision', async () => {
  const fetchImpl = fakeFetch();
  const r = createRoutineRelay({ routines: ROUTINES, fetchImpl, log: { log() {}, error() {} } });
  assert.equal(r.onWalidSave('project:nourmeet', ...approve), false);
  assert.equal(r.onWalidSave('project:leviaro', doc([{ id: 't', title: 'A' }]), doc([{ id: 't', title: 'B' }])), false);
  assert.equal(r.onWalidSave('money', ...approve), false);
  await r.tick();
  assert.equal(fetchImpl.calls.length, 0);
});

test('limite horaire de Claude (429) : la décision est gardée et repart après le délai indiqué', async () => {
  let clock = 0;
  let fetchImpl = fakeFetch(429);
  const r = createRoutineRelay({ routines: ROUTINES, fetchImpl: (...a) => fetchImpl(...a), now: () => clock, log: { log() {}, error() {} } });
  r.onWalidSave('project:leviaro', ...approve);
  await r.tick();
  assert.equal(r.pending.size, 1);
  fetchImpl = fakeFetch(200);
  clock += 60 * 1000;
  await r.tick();
  assert.equal(fetchImpl.calls.length, 0); // encore bloqué (Retry-After 120 s)
  clock += 61 * 1000;
  await r.tick();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(r.pending.size, 0);
});

test('jeton refusé (401) : prévient Walid une fois, ne réessaie pas en boucle', async () => {
  const fetchImpl = fakeFetch(401);
  const notes = [];
  const r = createRoutineRelay({ routines: ROUTINES, fetchImpl, notify: async (t) => notes.push(t), log: { log() {}, error() {} } });
  r.onWalidSave('project:leviaro', ...approve);
  await r.tick();
  await r.tick();
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(notes[0], /impossible de relancer/);
});
