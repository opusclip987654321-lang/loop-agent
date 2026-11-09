import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';
import { masquer, nettoyerReponses, nettoyerMesReponses, enregistrerATrier } from '../server/reponses-nour.js';
import { nettoyer } from '../server/releve-nour.js';
import { defaultProjectDoc } from '../server/defaults.js';
import { PROJECTS } from '../server/projects.js';

test('masque adresses et téléphones, garde le reste', () => {
  assert.equal(masquer('Appelez-moi au 06 12 34 56 78 ou chef@resto.fr, le 12/11'), 'Appelez-moi au [téléphone masqué] ou [adresse masquée], le 12/11');
  const r = nettoyerReponses([{ cle: 'a'.repeat(16), jour: '2026-11-08', nom: 'Chez Ali', objet: 'Re: Nūr Meet', texte: 'Oui, rappelez-moi au +33 6 12 34 56 78' }, { cle: 'bad', jour: '2026-11-08', texte: 'x' }]);
  assert.equal(r.length, 1);
  assert.match(r[0].texte, /\[téléphone masqué\]/);
  assert.equal(nettoyer({ jours: { '2026-11-08': { premiers: 1 } }, reponses: [{ cle: 'b'.repeat(16), jour: '2026-11-08', texte: 'stop' }] }).reponses.length, 1);
});

test('tri : un intéressé devient une demande à Walid, le texte est effacé, l’indicateur rempli', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-tri-'));
  const db = openDb(dataDir);
  const events = [];
  const tools = Object.fromEntries(createAgentTools({ db, dataDir, onToolDone: (...a) => events.push(a) }).map((t) => [t.name, t]));
  try {
    const doc = defaultProjectDoc(PROJECTS.find((x) => x.id === 'nourmeet'));
    doc.kpis = [{ id: 'kpi-int', name: 'Réponses intéressées', agg: 'somme', status: 'valide' }];
    db.putDoc('project:nourmeet', JSON.stringify(doc), 0, 'walid');
    const today = new Date().toISOString().slice(0, 10);
    const cle1 = '1'.repeat(16), cle2 = '2'.repeat(16);
    assert.equal(enregistrerATrier(db, nettoyerReponses([
      { cle: cle1, jour: today, nom: 'Le Bistrot', ville: 'Paris', objet: 'Re: soirées', texte: 'Intéressé, appelez le 0612345678' },
      { cle: cle2, jour: today, objet: 'Absence', texte: 'Je suis absent' },
      { cle: '3'.repeat(16), jour: '2026-10-01', nom: 'Vieux Resto', objet: 'Re: soirées', texte: 'Combien ça coûte ?' },
    ]), today), 3);
    assert.equal(enregistrerATrier(db, nettoyerReponses([{ cle: cle1, jour: today, texte: 'x' }]), today), 0);
    const p = await tools.lire_projet.handler({ projet: 'nourmeet' });
    assert.equal(p.reponses_restaurants.a_trier, 3);
    const a = await tools.reponses_a_trier.handler({ projet: 'nourmeet' });
    assert.equal(a.reponses.length, 3);
    assert.ok(!JSON.stringify(a).includes('0612345678'));
    const msg = await tools.trier_reponses.handler({ projet: 'nourmeet', reponses: [
      { cle: cle1, type: 'INTERESSE', resume: 'Veut être rappelé pour en parler.' },
      { cle: cle2, type: 'AUTOMATIQUE', resume: 'Message d’absence.' },
      { cle: '3'.repeat(16), type: 'QUESTION', resume: 'Demande le prix.' },
    ] });
    assert.match(msg, /3 réponse\(s\) triée\(s\).*2 demande/);
    const apres = JSON.parse(db.getDoc('project:nourmeet').value);
    const t = apres.tasks.find((x) => x.id === 'nourmeet-mails');
    assert.equal(t.demandes.length, 2);
    assert.ok(t.demandes.some((d) => /Vieux Resto/.test(d.texte)));
    const bistrot = t.demandes.find((d) => /Le Bistrot/.test(d.texte));
    assert.match(bistrot.pieces[0].texte, /\[téléphone masqué\]/);
    assert.equal(apres.kpiValues.find((v) => v.kpi === 'kpi-int' && v.date === today).value, 1);
    assert.ok(events.some((e) => e[1] === 'demander_a_walid'));
    const etat = JSON.parse(db.getDoc('nour-reponses').value);
    assert.equal(Object.keys(etat.aTrier).length, 0);
    assert.ok(!JSON.stringify(etat).includes('Intéressé, appelez'));
    // Walid répond au Bistrot : le relevé suivant le voit dans ses mails envoyés, la demande se ferme seule.
    enregistrerATrier(db, nettoyerReponses([{ cle: cle1, jour: today, texte: 'x', repondu_le: today }]), today);
    const ferme = JSON.parse(db.getDoc('project:nourmeet').value).tasks.find((x) => x.id === 'nourmeet-mails').demandes.find((d) => /Le Bistrot/.test(d.texte));
    assert.equal(ferme.statut, 'faite');
    assert.match(ferme.reponse, /tu as répondu/);
    // Une réponse positive à laquelle Walid a déjà répondu n'ouvre pas de demande.
    const cle4 = '4'.repeat(16);
    enregistrerATrier(db, nettoyerReponses([{ cle: cle4, jour: today, nom: 'Déjà Vu', texte: 'Oui !', repondu_le: today }]), today);
    await tools.trier_reponses.handler({ projet: 'nourmeet', reponses: [{ cle: cle4, type: 'INTERESSE', resume: 'Oui.' }] });
    assert.ok(!JSON.stringify(JSON.parse(db.getDoc('project:nourmeet').value).tasks).includes('Déjà Vu'));
    // Ce que Walid écrit au restaurant apparaît dans la discussion, masqué.
    enregistrerATrier(db, [], today, undefined, nettoyerMesReponses([{ cle: '9'.repeat(16), jour: today, nom: 'Le Bistrot', objet: 'Re: soirées', texte: 'Bonjour, je vous appelle demain au 0611223344.' }]));
    const fil = (await tools.lire_projet.handler({ projet: 'nourmeet' })).reponses_restaurants.discussions.find((x) => x.restaurant === 'Le Bistrot');
    assert.deepEqual(fil.echanges.map((x) => x.de), ['restaurant', 'walid']);
    assert.match(fil.echanges[1].texte, /\[téléphone masqué\]/);
    // Un second tri des mêmes clés ne fait rien (pas de doublon de demande).
    assert.match(await tools.trier_reponses.handler({ projet: 'nourmeet', reponses: [{ cle: cle1, type: 'INTERESSE', resume: 'x' }] }), /Aucune réponse/);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
