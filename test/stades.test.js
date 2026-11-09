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

test('idée finie : quitte l’action, va dans la Mémoire ; action finie quand tout est fait', async () => {
  const { finirIdee, finirAction, toutesFinies } = await import('../server/stades.js');
  const t = { id: 'a1', title: 'Suivi Patreon', ideas: [idee(), idee({ text: 'Lire le libellé' }), idee({ dropped: true })] };
  const m = finirIdee(t, t.ideas[0], { preuve: 'Relevé Patreon API toutes les 3 h depuis le 09/11', remplaceePar: 'le relevé Patreon automatique', jour: '2026-11-09', at: 'x' });
  assert.equal(m.tag, 'Idée remplacée');
  assert.equal(t.ideas[0].latestStage, 'Mémoire');
  assert.equal(finirIdee(t, t.ideas[0], { preuve: 'p', jour: 'j' }), null);
  assert.equal(toutesFinies(t), false);
  finirIdee(t, t.ideas[1], { preuve: 'p', jour: '2026-11-09' });
  assert.equal(toutesFinies(t), true);
  const fin = finirAction(t, { raison: 'Tout est fait', jour: '2026-11-09', at: 'x' });
  assert.equal(t.done, true);
  assert.equal(fin.tag, 'Action terminée');
  assert.deepEqual(resumeStades(t), []);
});

test('ecrire_tour : l’agent marque une idée remplacée et termine une boucle inutile, avec preuve', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openDb } = await import('../server/db.js');
  const { createAgentTools } = await import('../server/agent-tools.js');
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-fin-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((x) => [x.name, x]));
  try {
    const doc = { tasks: [{ id: 'suivi', title: 'Suivi Patreon', type: 'Boucle', autonomy: 'autonome', proposalStatus: 'approved', ideas: [idee({ text: 'Transfert des mails' }), idee({ text: 'Compter les payants' })] }], memories: [] };
    db.putDoc('project:impacteur-communaute', JSON.stringify(doc), 0, 'walid');
    await assert.rejects(() => tools.ecrire_tour.handler({ projet: 'impacteur-communaute', action: 'suivi', constat: 'c', decision: 'd', idees: [{ index: 0, faite: true }] }));
    await tools.ecrire_tour.handler({ projet: 'impacteur-communaute', action: 'suivi', constat: 'Relevé Patreon en place', decision: 'Fin', idees: [{ index: 0, remplacee_par: 'le relevé Patreon automatique', preuve: '90 membres gratuits relevés le 09/11' }], terminee: true, raison_fin: 'Le relevé Patreon automatique compte les membres toutes les 3 h.' });
    const d = JSON.parse(db.getDoc('project:impacteur-communaute').value);
    assert.equal(d.tasks[0].done, true);
    assert.equal(d.tasks[0].ideas[0].done.remplaceePar, 'le relevé Patreon automatique');
    assert.deepEqual(d.memories.map((m) => m.tag), ['Idée remplacée', 'Action terminée']);
    const p = await tools.lire_projet.handler({ projet: 'impacteur-communaute' });
    assert.ok(p.actions[0].terminee);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
