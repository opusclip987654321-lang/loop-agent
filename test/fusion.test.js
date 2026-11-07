import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/merge.js';

const { merge3, mergeDocs } = globalThis.LAMerge;

const base = {
  quota: 10,
  priorities: ['a', 'b'],
  tasks: [
    { id: 't1', title: 'Prospection', status: 'pending', ideas: [{ id: 'i1', text: 'x', walidReply: '' }] },
    { id: 't2', title: 'Relances', status: 'approved' },
  ],
  memories: [{ id: 'm1', text: 'leçon' }],
};
const clone = (o) => JSON.parse(JSON.stringify(o));

test('les changements de Walid et de l’agent sont gardés tous les deux', () => {
  const mine = clone(base);
  mine.tasks[0].status = 'approved'; // Walid valide
  mine.tasks[0].ideas[0].walidReply = 'oui, vas-y';
  const theirs = clone(base);
  theirs.tasks[1].lastAgentTurn = '2026-11-07'; // l'agent écrit son tour
  theirs.memories.push({ id: 'm2', text: 'nouvelle leçon' });
  theirs.tasks.push({ id: 't3', title: 'Nouvelle proposition', status: 'pending' });

  const out = merge3(base, mine, theirs);
  assert.equal(out.tasks[0].status, 'approved');
  assert.equal(out.tasks[0].ideas[0].walidReply, 'oui, vas-y');
  assert.equal(out.tasks[1].lastAgentTurn, '2026-11-07');
  assert.deepEqual(out.tasks.map((t) => t.id), ['t1', 't2', 't3']);
  assert.deepEqual(out.memories.map((m) => m.id), ['m1', 'm2']);
});

test('ajouts des deux côtés et suppressions', () => {
  const mine = clone(base);
  mine.tasks.splice(1, 1); // Walid supprime t2
  mine.tasks.push({ id: 'w1', title: 'Action de Walid' });
  const theirs = clone(base);
  theirs.memories = []; // l'agent supprime m1
  theirs.tasks.push({ id: 'a1', title: 'Action de l’agent' });

  const out = merge3(base, mine, theirs);
  assert.deepEqual(out.tasks.map((t) => t.id).sort(), ['a1', 't1', 'w1']);
  assert.deepEqual(out.memories, []);
});

test('même champ changé des deux côtés : Walid l’emporte', () => {
  const mine = clone(base);
  mine.quota = 5;
  mine.priorities = ['b', 'a'];
  const theirs = clone(base);
  theirs.quota = 20;
  const out = merge3(base, mine, theirs);
  assert.equal(out.quota, 5);
  assert.deepEqual(out.priorities, ['b', 'a']);
});

test('élément modifié par Walid mais supprimé par l’agent : gardé', () => {
  const mine = clone(base);
  mine.memories[0].text = 'corrigée';
  const theirs = clone(base);
  theirs.memories = [];
  assert.equal(merge3(base, mine, theirs).memories[0].text, 'corrigée');
});

test('mergeDocs sur chaînes, et null si JSON illisible', () => {
  const mine = clone(base);
  mine.quota = 3;
  const theirs = clone(base);
  theirs.memories.push({ id: 'm9', text: 'z' });
  const out = JSON.parse(mergeDocs(JSON.stringify(base), JSON.stringify(mine), JSON.stringify(theirs)));
  assert.equal(out.quota, 3);
  assert.equal(out.memories.length, 2);
  assert.equal(mergeDocs('{}', '{oups', '{}'), null);
});
