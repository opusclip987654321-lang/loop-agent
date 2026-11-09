// Méthode de la loop Nūr Meet dans Loop Agent.
//   … | node scripts/nour-methode.js importer   -> lit {methode, pause} sur l'entrée standard (copie depuis le cerveau)
//   node scripts/nour-methode.js voir            -> version, mails par jour, relances, recherches (sans le secret)
//   node scripts/nour-methode.js adresse         -> l'adresse SECRÈTE à coller dans n8n (ne la colle nulle part ailleurs)
//   node scripts/nour-methode.js revenir <v>     -> remet une version de l'historique
import { randomBytes } from 'node:crypto';
import { charger, enregistrer, verifier } from '../server/nour-methode.js';

const dataDir = process.env.DATA_DIR || './data';
const SITE = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/+$/, '') : 'https://loopagent.actualitevideo.fr';
const [cmd, arg] = process.argv.slice(2);
const etat = charger(dataDir) || { historique: [] };

if (cmd === 'importer') {
  let input = '';
  for await (const c of process.stdin) input += c;
  let src;
  try {
    src = JSON.parse(input);
  } catch {
    console.log('Entrée illisible : il faut le JSON {methode, pause}.');
    process.exit(1);
  }
  const err = verifier(src.methode);
  if (err.length) {
    console.log('Méthode refusée : ' + err.join(' ; '));
    process.exit(1);
  }
  etat.secret = etat.secret || randomBytes(16).toString('hex');
  etat.methode = src.methode;
  etat.pause = Boolean(src.pause);
  etat.historique = [{ version: src.methode.version, at: new Date().toISOString(), par: 'import du cerveau central', methode: src.methode }, ...(etat.historique || [])].slice(0, 60);
  enregistrer(dataDir, etat);
  console.log(`Méthode v${src.methode.version} importée${etat.pause ? ' (en pause)' : ''}. Elle est servie par Loop Agent.`);
} else if (cmd === 'importer-revue') {
  // Lit le fichier loop-nour-meet.json du cerveau central : historique daté, leçons et revues
  // passées, pour que la revue du lundi de Loop Agent reparte de là où le cerveau s'est arrêté.
  let input = '';
  for await (const c of process.stdin) input += c;
  let src;
  try {
    src = JSON.parse(input);
  } catch {
    console.log('Entrée illisible : il faut le fichier loop-nour-meet.json du cerveau.');
    process.exit(1);
  }
  if (!etat.methode) {
    console.log('Aucune méthode dans Loop Agent : importe d’abord la méthode.');
    process.exit(1);
  }
  const hist = (src.historique || []).filter((h) => h && Number.isInteger(h.version) && h.methode && !verifier(h.methode).length);
  if (!hist.some((h) => h.version === etat.methode.version)) {
    console.log(`La version en place (v${etat.methode.version}) n’est pas dans l’historique du cerveau : rien n’est importé.`);
    process.exit(1);
  }
  etat.historique = hist
    .map((h) => ({ version: h.version, at: h.quand, par: h.par, changements: h.changements, pourquoi: h.pourquoi, methode: h.methode }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 60);
  etat.lecons = (src.lecons || []).map((l) => ({ semaine: l.semaine, texte: String(l.texte || '').slice(0, 300) })).slice(-40);
  etat.revues = (src.revues || [])
    .filter((r) => !r.erreur)
    .map((r) => ({ semaine: r.semaine, at: r.quand, changer: r.changer, version: r.version, changements: r.changements || [], pourquoi: r.pourquoi || '', question: r.question || null, erreur: null }))
    .slice(0, 30);
  enregistrer(dataDir, etat);
  console.log(`Importé du cerveau : ${etat.historique.length} version(s) datée(s), ${etat.lecons.length} leçon(s), ${etat.revues.length} revue(s). Version en place : v${etat.methode.version} depuis le ${etat.historique.find((h) => h.version === etat.methode.version).at.slice(0, 10)}.`);
} else if (cmd === 'voir') {
  if (!etat.methode) {
    console.log('Aucune méthode.');
    process.exit(1);
  }
  const m = etat.methode;
  console.log(`version ${m.version}${etat.pause ? ' · EN PAUSE' : ''} · ${m.parJour} mails/jour · relances à ${m.relanceJours.join(' et ')} jours · ${m.recherches.length} recherche(s)`);
  console.log(`objet du premier mail : ${m.textes.initial.objet}`);
  console.log(`historique : ${(etat.historique || []).map((h) => `v${h.version} (${h.par}, ${h.at.slice(0, 10)})`).join(' · ')}`);
} else if (cmd === 'adresse') {
  if (!etat.secret) {
    console.log('Aucune méthode importée.');
    process.exit(1);
  }
  console.log(`${SITE}/loop/nour-meet/${etat.secret}`);
} else if (cmd === 'revenir' && arg) {
  const h = (etat.historique || []).find((x) => String(x.version) === String(arg).replace(/^v/, ''));
  if (!h) {
    console.log(`Version ${arg} absente de l'historique.`);
    process.exit(1);
  }
  etat.methode = h.methode;
  etat.historique = [{ version: h.version, at: new Date().toISOString(), par: 'retour en arrière (Walid)', methode: h.methode }, ...etat.historique].slice(0, 60);
  enregistrer(dataDir, etat);
  console.log(`Méthode revenue à la v${h.version}.`);
} else {
  console.log('Usage : importer (JSON sur l’entrée standard) | importer-revue (loop-nour-meet.json du cerveau sur l’entrée standard) | voir | adresse | revenir <version>');
  process.exitCode = 1;
}
