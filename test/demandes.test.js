import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools, demandesDansTexte } from '../server/agent-tools.js';
import { decisionsBetween } from '../server/routines.js';
import { describeEvent } from '../server/telegram.js';

test('repère « Pour Walid : … » et « Walid doit … », mais pas le tableau « Fait pour Walid »', () => {
  assert.deepEqual(demandesDansTexte('Contrôle fait. Pour Walid : me donner accès à Search Console. Suite lundi.'), ['me donner accès à Search Console.']);
  assert.deepEqual(demandesDansTexte('Walid doit choisir A ou D. Le reste avance.'), ['Walid doit choisir A ou D.']);
  assert.deepEqual(demandesDansTexte('Ligne ajoutée dans « Fait pour Walid » : 3 mails.'), []);
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-dem-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  return { db, tools, doc: () => JSON.parse(db.getDoc('project:ebook').value), done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}

test('une demande reste ouverte et l’action rouge, même après la validation du premier résultat', async () => {
  const s = setup();
  try {
    const p = await s.tools.lire_projet.handler({ projet: 'ebook' });
    const action = p.actions[0].id;
    const msg = await s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Couvertures prêtes. Walid doit choisir A ou D.', decision: 'Attendre.' });
    assert.match(msg, /1 demande\(s\) à Walid enregistrée/);
    // Walid valide le premier résultat (ce que fait la page) : la demande ne bouge pas.
    const key = 'project:ebook';
    const cur = s.db.getDoc(key);
    const d = JSON.parse(cur.value);
    const t = d.tasks.find((x) => x.id === action);
    t.firstRunPending = false;
    t.autonomy = 'Autonome';
    s.db.putDoc(key, JSON.stringify(d), cur.version, 'walid');
    const apres = await s.tools.lire_projet.handler({ projet: 'ebook' });
    const a = apres.actions.find((x) => x.id === action);
    assert.equal(a.couleur, 'rouge');
    assert.equal(a.demandes_a_walid[0].statut, 'ouverte');
    // L'agent répète la même phrase : pas de doublon.
    await s.tools.ecrire_tour.handler({ projet: 'ebook', action, constat: 'Walid doit choisir A ou D.', decision: 'Attendre.' });
    assert.equal(s.doc().tasks.find((x) => x.id === action).demandes.length, 1);
    // Outil explicite.
    assert.match(await s.tools.demander_a_walid.handler({ projet: 'ebook', action, demande: 'Donner le nom d’auteur' }), /Demande enregistrée/);
  } finally {
    s.done();
  }
});

test('fermer une demande est une décision de Walid (relance) ; Telegram la signale', () => {
  const avant = JSON.stringify({ tasks: [{ id: 't', title: 'Livre 1', demandes: [{ id: 'd1', texte: 'Choisir A ou D', statut: 'ouverte' }] }] });
  const apres = JSON.stringify({ tasks: [{ id: 't', title: 'Livre 1', demandes: [{ id: 'd1', texte: 'Choisir A ou D', statut: 'faite', reponse: 'A' }] }] });
  assert.deepEqual(decisionsBetween(avant, apres), ['demande « Choisir A ou D » sur « Livre 1 » : faite (réponse de Walid : « A »)']);
  assert.match(describeEvent('demander_a_walid', { projet: 'ebook', demande: 'Choisir A ou D' }).line, /🔴 Demande à Walid \(ebook\) : Choisir A ou D/);
});
