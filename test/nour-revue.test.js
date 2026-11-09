import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';
import { enregistrer, charger } from '../server/nour-methode.js';
import { nettoyerDonnees, enregistrerDonnees, statsLoop, revueAFaire, appliquerRevue, filet, empreinteNom } from '../server/nour-revue.js';
import { nettoyer } from '../server/releve-nour.js';
import { defaultProjectDoc } from '../server/defaults.js';
import { PROJECTS } from '../server/projects.js';

const texte = (n) => ({ objet: `Objet ${n}`, corps: `Bonjour {nom}, {accroche} {lien} {pied}` });
const methode = (v) => ({ version: v, textes: { initial: texte(1), relance1: texte(2), relance2: texte(3) }, recherches: ['restaurant Paris'], relanceJours: [4, 9], parJour: 50 });
const etatDe = (at) => ({ secret: 'a'.repeat(32), methode: methode(3), historique: [{ version: 3, at, par: 'la loop (revue du lundi)', methode: methode(3) }, { version: 2, at: '2026-10-19T09:00:00Z', par: 'la loop (revue du lundi)', methode: { ...methode(2), parJour: 40 } }] });

test('données de revue : seuls les champs attendus passent, par le relevé', () => {
  const d = nettoyerDonnees({ contactes: [{ h: 'abcdef123456', dep: '75', recherche: 'resto halal', prix: '€€', halal: true, nom: 'secret', mails: [['2026-11-02', 3, 'initial'], ['x', 1, 'initial'], ['2026-11-06', 3, 'autre']] }, { h: 'pas-bon' }], parJour: { '2026-11-02': [10, 1] }, sansEmail: 4 });
  assert.equal(d.contactes.length, 1);
  assert.deepEqual(d.contactes[0].mails, [['2026-11-02', 3, 'initial']]);
  assert.equal(d.contactes[0].nom, undefined);
  assert.equal(nettoyer({ jours: { '2026-11-08': { premiers: 1 } }, revue: { contactes: [], parJour: {} } }).revue.contactes.length, 0);
});

test('chiffres : une réponse positive est rendue au dernier mail avant elle', () => {
  const h = empreinteNom('Le Bistrot');
  const donnees = { contactes: [{ h, dep: '75', mails: [['2026-11-01', 3, 'initial'], ['2026-11-05', 3, 'relance1'], ['2026-11-12', 3, 'relance2']] }, { h: empreinteNom('Autre'), dep: '93', mails: [['2026-11-01', 3, 'initial']] }], parJour: {}, sansEmail: 0 };
  const s = statsLoop(donnees, { a: { type: 'INTERESSE', nom: 'Le Bistrot', jour: '2026-11-07' }, b: { type: 'REFUS', nom: 'Autre', jour: '2026-11-02' } });
  assert.equal(s.positifs, 1);
  assert.equal(s.parVersionEtType.find((x) => x.type === 'relance1').positifs, 1);
  assert.equal(s.parZone.Paris.positifs, 1);
  assert.equal(s.parZone['dép. 93'].positifs, 0);
});

test('revue due : lundi après 9 h, version de 6 jours au moins, une fois par semaine', () => {
  const etat = etatDe('2026-11-05T18:43:00Z');
  assert.equal(revueAFaire(etat, new Date('2026-11-09T10:00:00Z')), null); // version de 4 jours
  assert.equal(revueAFaire(etat, new Date('2026-11-12T10:00:00Z')), '2026-11-09'); // rattrapage jeudi
  const e2 = etatDe('2026-11-01T10:00:00Z');
  assert.equal(revueAFaire(e2, new Date('2026-11-09T07:00:00Z')), null); // lundi 8 h Paris
  assert.equal(revueAFaire(e2, new Date('2026-11-09T09:00:00Z')), '2026-11-09');
  appliquerRevue(e2, { changer: false, pourquoi: 'rien' }, '2026-11-09', '2026-11-09T09:00:00Z');
  assert.equal(revueAFaire(e2, new Date('2026-11-10T09:00:00Z')), null);
});

test('revue : changement vérifié appliqué, radical en attente, invalide écarté', () => {
  const etat = etatDe('2026-11-01T10:00:00Z');
  const e = appliquerRevue(etat, { changer: true, methode: { parJour: 60 }, changements: ['60 mails'], pourquoi: 'p', lecons: ['l1'] }, '2026-11-09', '2026-11-09T09:00:00Z');
  assert.equal(e.version, 4);
  assert.equal(etat.methode.parJour, 60);
  assert.equal(etat.historique[0].version, 4);
  assert.equal(etat.lecons.length, 1);
  const r = appliquerRevue(etat, { changer: true, radical: true, methode: { recherches: ['restaurant Lyon'] }, question: 'Lyon ?' }, '2026-11-16', '2026-11-16T09:00:00Z');
  assert.equal(r.question, 'Lyon ?');
  assert.equal(etat.methode.version, 4);
  assert.ok(etat.propositionRadicale);
  const x = appliquerRevue(etat, { changer: true, methode: { textes: { initial: { corps: 'sans lien' } } } }, '2026-11-23', '2026-11-23T09:00:00Z');
  assert.match(x.erreur, /Changement écarté/);
  assert.equal(etat.methode.version, 4);
});

test('filet : une version qui casse les envois est annulée seule', () => {
  const etat = etatDe('2026-11-05T08:00:00Z');
  const donnees = { contactes: [], parJour: { '2026-11-01': [10, 0], '2026-11-03': [10, 1], '2026-11-06': [2, 10], '2026-11-07': [1, 8] }, sansEmail: 0 };
  const r = filet(etat, donnees, new Date('2026-11-08T10:00:00Z'));
  assert.ok(r && r.version === 4);
  assert.equal(etat.methode.parJour, 40); // retour à la v2
  assert.match(etat.lecons[0].texte, /annulée par le filet/);
  assert.equal(filet(etat, donnees, new Date('2026-11-08T11:00:00Z')), null); // pas deux fois
});

test('outils : revue due, écriture, radical devient une demande à Walid', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-revue-'));
  const db = openDb(dataDir);
  const events = [];
  const tools = Object.fromEntries(createAgentTools({ db, dataDir, onToolDone: (...a) => events.push(a) }).map((t) => [t.name, t]));
  try {
    db.putDoc('project:nourmeet', JSON.stringify(defaultProjectDoc(PROJECTS.find((x) => x.id === 'nourmeet'))), 0, 'walid');
    enregistrer(dataDir, etatDe('2020-01-01T00:00:00Z'));
    enregistrerDonnees(db, { contactes: [], parJour: {}, sansEmail: 0 });
    const r = await tools.revue_methode_nour.handler({ projet: 'nourmeet' });
    assert.ok(r.semaine);
    assert.ok(r.donnees.chiffres);
    const msg = await tools.ecrire_revue_nour.handler({ projet: 'nourmeet', semaine: r.semaine, revue: { changer: true, radical: true, methode: { parJour: 30 }, changements: ['Viser Lyon'], pourquoi: 'p', question: 'On essaie Lyon ?' } });
    assert.match(msg, /décision de Walid/);
    const doc = JSON.parse(db.getDoc('project:nourmeet').value);
    const d = doc.tasks.find((t) => t.id === 'nourmeet-mails').demandes.find((x) => x.radicale === r.semaine);
    assert.ok(d);
    assert.ok(events.some((e) => e[1] === 'demander_a_walid'));
    assert.equal(charger(dataDir).methode.version, 3);
    await assert.rejects(() => tools.ecrire_revue_nour.handler({ projet: 'nourmeet', semaine: r.semaine, revue: { changer: false } }));
    const p = await tools.lire_projet.handler({ projet: 'nourmeet' });
    assert.equal(p.methode_prospection.version, 3);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rattrapage du relevé : chaque jour passé reçoit ses contacts et son taux d’ouverture', async () => {
  const { appliquer } = await import('../server/releve-nour.js');
  const jours = {};
  for (let i = 1; i <= 40; i++) jours[`2026-10-${String((i % 28) + 1).padStart(2, '0')}`] = { premiers: i, envoyes7: 10, ouverts7: 3 };
  const r = nettoyer({ jours, glissant7: {} });
  assert.ok(Object.keys(r.jours).length >= 28);
  const doc = { kpis: [{ id: 'k-contact', name: 'Restaurants contactés', status: 'valide' }, { id: 'k-ouv', name: 'Taux d’ouverture', status: 'valide' }], kpiValues: [] };
  appliquer(doc, r, '2026-11-09T20:00:00Z');
  assert.equal(doc.kpiValues.filter((v) => v.kpi === 'k-ouv').length, Object.keys(r.jours).length);
  assert.equal(doc.kpiValues.find((v) => v.kpi === 'k-ouv').value, 30);
});
