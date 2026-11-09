import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, synchroniser, apresTour, apresResultat, apresLecon, resumeStades, aFaireDAbord } from '../server/stades.js';

const idee = (extra = {}) => ({ text: 'Essai', latestStage: 'Planification', stageHistory: [], approvalStatus: 'approved', ...extra });

test('ordre du cycle décidé par Walid', () => {
  assert.deepEqual(STAGES, ['Planification', 'Priorités', 'Exécution', 'Vérification', 'Révision', 'Mémoire']);
});

test('les idées avancent seules : tour, résultat, réponse de Walid, leçon ; jamais à reculons', () => {
  const t = { ideas: [idee({ source: 'IA' }), idee(), idee({ approvalStatus: 'pending', source: 'IA' }), idee({ dropped: true })] };
  synchroniser(t, '2026-11-09');
  assert.equal(t.ideas[0].latestStage, 'Priorités');
  apresTour(t, [], '2026-11-09');
  assert.deepEqual(t.ideas.map((i) => i.latestStage), ['Exécution', 'Exécution', 'Planification', 'Planification']);
  apresResultat(t, '2026-11-10');
  assert.equal(t.ideas[0].latestStage, 'Vérification');
  t.ideas[0].walidReply = 'ok, continue';
  t.ideas[0].walidReplyAt = '2026-11-11T09:00:00Z';
  synchroniser(t, '2026-11-11');
  assert.equal(t.ideas[0].latestStage, 'Révision');
  apresLecon(t, '2026-11-12');
  assert.equal(t.ideas[0].latestStage, 'Mémoire');
  apresTour(t, [0], '2026-11-13');
  assert.equal(t.ideas[0].latestStage, 'Mémoire');
  assert.deepEqual(resumeStades(t), [{ stade: 'Mémoire', idees: 2 }]);
});

test('garde-fou : idée jugée sans leçon, résultat sans compte rendu', () => {
  const t = { ideas: [idee({ latestStage: 'Vérification', stageHistory: [{ stage: 'Vérification', at: '2026-11-01' }] })], results: [{ at: '2026-11-08T10:00:00Z' }], lastAgentTurn: '2026-11-07T10:00:00Z' };
  const x = aFaireDAbord(t, Date.parse('2026-11-09T10:00:00Z'));
  assert.equal(x.length, 2);
  assert.match(x[0], /noter_lecon/);
  assert.match(x[1], /ecrire_tour/);
  t.ideas[0].stageHistory[0].at = '2026-11-08';
  t.lastAgentTurn = '2026-11-08T11:00:00Z';
  assert.equal(aFaireDAbord(t, Date.parse('2026-11-09T10:00:00Z')).length, 0);
});
