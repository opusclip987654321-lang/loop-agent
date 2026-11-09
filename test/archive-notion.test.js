import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveParProjet, pourAgent } from '../server/archive-notion.js';

test('archive Notion : chaque décision va dans son projet, « louis » redevient Walid', () => {
  const a = archiveParProjet({
    decisions: [
      { date: '2026-11-05', loop: 'Nūr Meet restaurateurs', type: 'Leçon', decision: 'Paris 4 sur 413', pourquoi: '—' },
      { date: '2026-10-21', loop: 'Nūr Meet grand public', type: 'Geste de louis', decision: 'La loop peut tout changer', pourquoi: 'Choix de louis' },
      { date: '2026-11-01', loop: 'SEO', type: 'Leçon', decision: 'Leviaro : SEO 90/100' },
      { date: '2026-10-19', loop: 'Toutes les loops', type: 'Leçon', decision: 'Limite atteinte' },
      { date: '2026-10-19', loop: 'Inconnue', type: 'Leçon', decision: 'x' },
    ],
    pages: [{ cle: 'nour-restos', titre: 'Nūr Meet restaurateurs', texte: 'Objectif : 20 abonnés' }, { cle: 'regles', titre: 'Règles', texte: 'r' }],
    fait: [{ date: '2026-11-09T11:38:00Z', projet: 'Nūr Meet', quoi: 'Tri : 4 réponses' }],
  });
  assert.equal(a.nourmeet.decisions.length, 2);
  assert.equal(a.leviaro.decisions.length, 1);
  assert.equal(a['gestion-loop-agent'].decisions.length, 1);
  assert.equal(a['gestion-loop-agent'].pages.length, 1);
  const v = pourAgent(a.nourmeet);
  assert.equal(v.lecons.length, 1);
  assert.equal(v.lecons[0].pourquoi, undefined);
  assert.equal(v.decisions[0].type, 'Geste de Walid');
  assert.equal(v.decisions[0].pourquoi, 'Choix de Walid');
  assert.equal(a.nourmeet.fait[0].date, '2026-11-09');
});
