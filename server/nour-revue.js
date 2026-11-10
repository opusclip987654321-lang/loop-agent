// Revue du lundi de la loop de prospection Nūr Meet (reprise du cerveau central, décision de
// Walid du 09/11/2026 : le cerveau s'éteint, Loop Agent fait tout).
// - Le relevé horaire du serveur Nūr envoie, en plus des chiffres du jour, un bloc « revue » :
//   chaque restaurant contacté (nom remplacé par une empreinte), son profil (département,
//   recherche Google, niveau de prix, halal, privatisation) et ses mails (jour, version, type),
//   plus les envois et échecs par jour. Rien d'autre.
// - Loop Agent le croise avec les réponses triées (reponses-nour.js) : chiffres par version de
//   texte et par profil, comme le cerveau (statsLoop).
// - Une tâche Claude (abonnement), chaque matin du lundi au mercredi à 9 h 23, lit revue_methode_nour :
//   s'il y a une revue due, elle décide et écrit avec ecrire_revue_nour. Mêmes garde-fous que le
//   cerveau : méthode vérifiée avant d'être servie à n8n, changement « radical » soumis à Walid,
//   leçons notées, et le filet qui annule seul une version qui casse les envois.
// L'état (leçons, revues, proposition radicale) vit dans DATA_DIR/nour-methode.json, à côté de
// la méthode et de son historique (nour-methode.js).

import { createHash } from 'node:crypto';
import { charger, enregistrer, verifier } from './nour-methode.js';
import { POSITIFS, lireEtat as lireTri } from './reponses-nour.js';

export const DONNEES = 'nour-revue-donnees';
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['initial', 'relance1', 'relance2'];

export const empreinteNom = (nom) => createHash('sha256').update(String(nom || '').trim().toLowerCase()).digest('hex').slice(0, 12);

export const jourParis = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
export function lundiDe(jour) {
  const d = new Date(jour + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const court = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const entier = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

// Ne garde que les champs attendus du bloc « revue » du relevé.
export function nettoyerDonnees(b) {
  if (!b || typeof b !== 'object') return null;
  const contactes = [];
  for (const p of (Array.isArray(b.contactes) ? b.contactes : []).slice(0, 5000)) {
    if (!p || !/^[a-f0-9]{12}$/.test(String(p.h))) continue;
    const mails = [];
    for (const m of (Array.isArray(p.mails) ? p.mails : []).slice(0, 6)) {
      if (Array.isArray(m) && JOUR.test(String(m[0])) && Number.isInteger(m[1]) && TYPES.includes(m[2])) mails.push([m[0], m[1], m[2]]);
    }
    contactes.push({ h: p.h, dep: court(p.dep, 3), recherche: court(p.recherche, 120), prix: court(p.prix, 4), halal: p.halal === true, privatisation: p.privatisation === true, mails });
  }
  const parJour = {};
  for (const [j, v] of Object.entries(b.parJour || {}).slice(-60)) if (JOUR.test(j) && Array.isArray(v)) parJour[j] = [entier(v[0]), entier(v[1])];
  return { contactes, parJour, sansEmail: entier(b.sansEmail) };
}

export function enregistrerDonnees(db, donnees, nowIso = new Date().toISOString()) {
  if (!donnees) return false;
  for (let i = 0; i < 5; i++) {
    const cur = db.getDoc(DONNEES);
    if (db.putDoc(DONNEES, JSON.stringify({ ...donnees, recu: nowIso }), cur ? cur.version : 0, 'agent:releve-n8n').ok) return true;
  }
  return false;
}

export function lireDonnees(db) {
  const cur = db.getDoc(DONNEES);
  return cur ? JSON.parse(cur.value) : null;
}

// Les chiffres de la loop (même calcul que le cerveau) : par version et type de mail, puis par profil.
// Une réponse positive est rendue au dernier mail parti vers ce restaurant avant elle.
export function statsLoop(donnees, triees) {
  if (!donnees) return null;
  const positifs = new Map();
  const types = {};
  for (const r of Object.values(triees || {})) {
    types[r.type] = (types[r.type] || 0) + 1;
    if (!r.nom || !POSITIFS.has(r.type)) continue;
    const h = empreinteNom(r.nom);
    if (!positifs.has(h) || r.jour < positifs.get(h)) positifs.set(h, r.jour);
  }
  const parCle = {};
  const cle = (v, t) => (parCle[`v${v} ${t}`] ??= { version: v, type: t, envoyes: 0, positifs: 0 });
  for (const p of donnees.contactes) for (const [, v, t] of p.mails) cle(v, t).envoyes += 1;
  for (const p of donnees.contactes) {
    if (!positifs.has(p.h)) continue;
    const avant = p.mails.filter((m) => m[0] <= positifs.get(p.h)).sort((a, b) => (a[0] > b[0] ? -1 : 1))[0];
    if (avant) cle(avant[1], avant[2]).positifs += 1;
  }
  const segment = (f) => {
    const g = {};
    for (const p of donnees.contactes) {
      const k = f(p) ?? '?';
      g[k] ??= { contactes: 0, positifs: 0 };
      g[k].contactes += 1;
      if (positifs.has(p.h)) g[k].positifs += 1;
    }
    return g;
  };
  return {
    contactes: donnees.contactes.length,
    envoyes: Object.values(parCle).reduce((s, x) => s + x.envoyes, 0),
    reponsesTriees: types,
    positifs: donnees.contactes.filter((p) => positifs.has(p.h)).length,
    parVersionEtType: Object.values(parCle).sort((a, b) => a.version - b.version || a.type.localeCompare(b.type)),
    parZone: segment((p) => (p.dep === '75' ? 'Paris' : p.dep ? `dép. ${p.dep}` : null)),
    parRecherche: segment((p) => p.recherche),
    parPrix: segment((p) => p.prix),
    halal: segment((p) => (p.halal ? 'halal confirmé' : 'non confirmé')),
    privatisation: segment((p) => (p.privatisation ? 'privatisable confirmé' : 'non confirmé')),
    sansEmail: donnees.sansEmail,
    envoisEtEchecsParJour: Object.fromEntries(Object.entries(donnees.parJour).slice(-21)),
  };
}

const versionEnCours = (etat) => (etat.historique || []).find((h) => h.version === etat.methode?.version) || (etat.historique || [])[0];

// Une revue par semaine, le lundi après 9 h ; un lundi manqué est rattrapé les jours suivants.
// Une version doit avoir tourné 6 jours avant d'être jugée.
export function revueAFaire(etat, maintenant = new Date()) {
  if (!etat || !etat.methode || etat.pause) return null;
  const jour = jourParis(maintenant);
  const h = Number(new Date(maintenant).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }));
  if (new Date(`${jour}T12:00:00Z`).getUTCDay() === 1 && h < 9) return null;
  const v = versionEnCours(etat);
  if (v && new Date(maintenant) - new Date(v.at) < 6 * 86400000) return null;
  const semaine = lundiDe(jour);
  return (etat.revues || []).some((r) => r.semaine === semaine && !r.erreur) ? null : semaine;
}

export const CONSIGNE_REVUE = `Tu pilotes seul la loop de prospection des restaurateurs de Nūr Meet (soirées speed dating et networking dans des restaurants d'Île-de-France ; le restaurant paie un abonnement : Standard 69 € HT/mois ou Premium 89 € HT/mois, sans engagement).
ESSAI GRATUIT (décision de Walid du 10/11/2026) : un restaurant qui hésite peut essayer 1 mois gratuitement, sans carte bancaire, depuis son espace restaurateur ; rien n'est prélevé à la fin, il choisit alors une formule ou l'essai s'arrête. Tu peux le dire dans les mails et les relances : ce n'est pas un changement « radical ». Ne promets rien de plus (ni durée plus longue, ni gratuité sans limite).
OBJECTIF : 20 restaurateurs abonnés payants. Étapes : réponse positive, inscription, abonnement.
Commence par relire tes LEÇONS : ne refais pas un essai déjà raté sans raison nouvelle. Puis décide la méthode de la semaine, un essai à la fois quand c'est possible. Si les données sont trop maigres, ne change rien et dis-le.
Tu peux changer : textes (objet et corps de initial, relance1, relance2), recherches Google Maps (1 à 10), jours de relance, premiers mails par jour (10 à 80).
Règles fixes : français, vouvoiement ; chaque corps contient {lien} et {pied} ; variables {nom} {lieu} {accroche} {lien} {pied} ; n'invente rien sur Nūr Meet (ni chiffres, ni clients, ni promesse) ; aucune adresse mail ni numéro.
« radical » = changer l'offre ou le prix, viser autre chose que des restaurants, ou quitter l'Île-de-France : rien n'est appliqué, ta question va à Walid (une demande dans Loop Agent). Si « walid_sur_radical » montre que Walid a accepté une proposition, tu peux l'appliquer avec radical:false en citant sa réponse.
PISTES DE WALID (à peser, pas des ordres) : tunnel pour voir où l'on perd (le restaurateur comprend-il Nūr Meet ? s'inscrit-il ? paie-t-il ?) ; tester objets et corps des mails avec les ouvertures et, si utile, les clics. Un outil qui manque se propose dans « changements ».
ORGANIQUE IA (Walid, 21/10, à peser) : une page « remplir son restaurant en semaine » avec le cas du Casanova après sa soirée, citée dans les mails ; 2 posts LinkedIn par semaine écrits pour Walid, qu'il publie ; fiche Google Business et pages par ville, pour être cité par Google et les IA ; Walid peut tourner 2 vidéos de 30 s par semaine pour les restaurateurs. Ce qui demande un outil ou Walid se propose dans « changements ».
RECHERCHE WEB : autorisée sans demander à Walid, chaque fois qu'elle aide l'objectif : concurrents, idées, être cité par les IA (ChatGPT, Perplexity, Google).
« pourquoi » est ton journal de décisions : même si tu ne changes rien, dis ce que tu as remis en question et pourquoi tu gardes, chiffres à l'appui.
FILET : si ton changement casse les envois (échecs en masse, plus aucun mail), Loop Agent revient seul à la version d'avant et te le note dans tes leçons. Une version qui envoie mais rapporte moins n'est PAS annulée : c'est à toi d'en juger, sans seuil d'arrêt (Walid veut une loop libre).
« lecons » : ce que cette semaine t'apprend, une ligne par essai jugé (essai, chiffre, gardé ou arrêté), ou une erreur à ne pas refaire ; vide si rien de neuf.
Rends ta décision avec ecrire_revue_nour, champ « revue » = cet objet :
{"changer":true|false,"methode":{"textes":{…},"recherches":[…],"relanceJours":[a,b],"parJour":n},"changements":["une phrase par changement"],"pourquoi":"2 à 4 phrases chiffrées","lecons":["une ligne"],"radical":false,"question":"pour Walid si radical, sinon vide"}
« methode » ne contient que ce qui change.`;

// Fusionne une méthode proposée dans la méthode en cours ; renvoie { methode } ou { erreur }.
export function fusionner(actuelle, changement = {}) {
  const m = structuredClone(actuelle);
  if (changement.textes) {
    for (const [t, v] of Object.entries(changement.textes)) {
      if (!TYPES.includes(t)) return { erreur: `type de mail inconnu : ${t}` };
      m.textes[t] = { objet: String(v?.objet ?? m.textes[t].objet).slice(0, 200), corps: String(v?.corps ?? m.textes[t].corps).slice(0, 3000) };
    }
  }
  if (changement.recherches) m.recherches = [...new Set(changement.recherches.map((x) => String(x).trim().slice(0, 80)).filter(Boolean))];
  if (changement.relanceJours) m.relanceJours = changement.relanceJours.map(Number);
  if (changement.parJour !== undefined) m.parJour = Number(changement.parJour);
  m.version = actuelle.version;
  const err = verifier(m);
  return err.length ? { erreur: err.join(' ; ') } : { methode: m };
}

export function noterLecons(etat, lecons, semaine) {
  const neuves = (Array.isArray(lecons) ? lecons : []).map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 5);
  etat.lecons = [...(etat.lecons || []), ...neuves.map((texte) => ({ semaine, texte }))].slice(-40);
}

function nouvelleVersion(etat, methode, { par, changements, pourquoi, at }) {
  const version = Math.max(etat.methode.version, ...(etat.historique || []).map((h) => h.version)) + 1;
  methode.version = version;
  etat.methode = methode;
  etat.historique = [{ version, at, par, changements, pourquoi, methode: structuredClone(methode) }, ...(etat.historique || [])].slice(0, 60);
  return version;
}

// Applique la revue (le JSON de la consigne). Renvoie l'entrée gardée dans etat.revues.
export function appliquerRevue(etat, d, semaine, at) {
  const entree = { semaine, at, changer: false, version: null, changements: [], pourquoi: '', question: null, erreur: null };
  if (!d || typeof d !== 'object') entree.erreur = 'Revue illisible.';
  else {
    entree.changements = (Array.isArray(d.changements) ? d.changements : []).map((x) => String(x).slice(0, 400)).slice(0, 10);
    entree.pourquoi = String(d.pourquoi ?? '').slice(0, 1500);
    noterLecons(etat, d.lecons, semaine);
    if (d.changer) {
      const v = fusionner(etat.methode, d.methode || {});
      if (v.erreur) entree.erreur = d.radical ? `Proposition écartée : ${v.erreur}` : `Changement écarté : ${v.erreur}`;
      else if (d.radical) {
        entree.question = String(d.question || 'Ce changement est important : je l’applique ?').slice(0, 600);
        etat.propositionRadicale = { semaine, at, methode: v.methode, changements: entree.changements, pourquoi: entree.pourquoi, question: entree.question };
      } else {
        entree.changer = true;
        entree.version = nouvelleVersion(etat, v.methode, { par: 'la loop (revue du lundi)', changements: entree.changements, pourquoi: entree.pourquoi, at });
      }
    }
  }
  etat.revues = [entree, ...(etat.revues || []).filter((r) => !(r.semaine === semaine && r.erreur))].slice(0, 30);
  return entree;
}

// Le filet (Walid, 21/10) : un changement de la loop qui CASSE les envois est annulé seul.
// Cassé = plus de la moitié des envois en échec depuis la nouvelle version (moins d'un quart
// la semaine d'avant), ou plus aucun envoi pendant 3 jours alors qu'il en partait avant.
export function filet(etat, donnees, maintenant = new Date()) {
  const [dernier, avant] = etat.historique || [];
  if (!dernier || !avant || dernier.version !== etat.methode?.version || !String(dernier.par || '').startsWith('la loop') || !donnees) return null;
  const debut = jourParis(new Date(dernier.at));
  const aujourdhui = jourParis(maintenant);
  const semaineAvant = jourParis(new Date(new Date(dernier.at) - 7 * 86400000));
  const somme = (f) => Object.entries(donnees.parJour).filter(([j]) => f(j)).reduce((s, [, [e, x]]) => [s[0] + e, s[1] + x], [0, 0]);
  const [eA, xA] = somme((j) => j > debut && j <= aujourdhui);
  const [eP, xP] = somme((j) => j >= semaineAvant && j <= debut);
  const taux = (e, x) => (e + x ? x / (e + x) : 0);
  const jours = Math.floor((maintenant - new Date(dernier.at)) / 86400000);
  let cause = null;
  if (eA + xA >= 10 && taux(eA, xA) > 0.5 && taux(eP, xP) < 0.25) cause = `${Math.round(taux(eA, xA) * 100)} % des envois en échec depuis la version ${dernier.version} (${Math.round(taux(eP, xP) * 100)} % la semaine d'avant)`;
  else if (jours >= 3 && eA + xA === 0 && eP + xP >= 7) cause = `aucun mail parti en ${jours} jours depuis la version ${dernier.version} (${eP + xP} la semaine d'avant)`;
  if (!cause) return null;
  const at = new Date(maintenant).toISOString();
  const version = nouvelleVersion(etat, structuredClone(avant.methode), { par: 'le filet (annulation automatique)', changements: [`Retour à la méthode de la version ${avant.version} : la version ${dernier.version} cassait les envois.`], pourquoi: `Filet de sécurité : ${cause}.`, at });
  noterLecons(etat, [`Version ${dernier.version} annulée par le filet : ${cause}. Ne pas la reprendre telle quelle.`], lundiDe(aujourdhui));
  return { version, cause };
}

// Ce que lit la tâche du lundi.
export function pourRevue(db, dataDir, maintenant = new Date()) {
  const etat = charger(dataDir);
  if (!etat || !etat.methode) return { semaine: null, raison: 'Aucune méthode dans Loop Agent.' };
  const semaine = revueAFaire(etat, maintenant);
  const base = {
    semaine,
    raison: semaine ? undefined : etat.pause ? 'Loop en pause.' : 'Pas de revue due (déjà faite cette semaine, ou version en place depuis moins de 6 jours).',
  };
  if (!semaine) return base;
  const tri = lireTri(db);
  const donnees = lireDonnees(db);
  return {
    ...base,
    consigne: CONSIGNE_REVUE,
    donnees: {
      methode: etat.methode,
      lecons: etat.lecons || [],
      historique: (etat.historique || []).slice(0, 10).map(({ methode, ...h }) => h),
      revues_precedentes: (etat.revues || []).slice(0, 4),
      proposition_radicale_en_attente: etat.propositionRadicale || null,
      chiffres: statsLoop(donnees, tri.triees) || 'indisponible (relevé du serveur Nūr pas encore reçu)',
      chiffres_recus_le: donnees?.recu || null,
      reponses: Object.values(tri.triees || {})
        .sort((a, b) => (b.jour > a.jour ? 1 : -1))
        .slice(0, 60)
        .map((r) => ({ jour: r.jour, restaurant: r.nom || 'inconnu', type: r.type, resume: r.resume })),
    },
  };
}

// Enregistre la revue rendue par la tâche ; renvoie l'entrée et, si radical, le texte de la demande.
export function ecrireRevue(dataDir, semaine, revue, maintenant = new Date()) {
  const etat = charger(dataDir);
  if (!etat || !etat.methode) throw new Error('Aucune méthode dans Loop Agent.');
  const due = revueAFaire(etat, maintenant);
  if (!due || due !== semaine) throw new Error(due ? `La revue due est celle de la semaine du ${due}.` : 'Aucune revue due : rien n’est changé.');
  const entree = appliquerRevue(etat, revue, semaine, new Date(maintenant).toISOString());
  enregistrer(dataDir, etat);
  return entree;
}

// Résumé pour lire_projet (agent Nūr Meet) et la page.
export function resume(dataDir) {
  const etat = charger(dataDir);
  if (!etat || !etat.methode) return null;
  const m = etat.methode;
  return {
    version: m.version,
    en_pause: Boolean(etat.pause),
    mails_par_jour: m.parJour,
    relances_jours: m.relanceJours,
    recherches: m.recherches,
    objet_premier_mail: m.textes?.initial?.objet,
    derniere_revue: (etat.revues || [])[0] || null,
    lecons: (etat.lecons || []).slice(-5),
    proposition_radicale_en_attente: etat.propositionRadicale ? { semaine: etat.propositionRadicale.semaine, question: etat.propositionRadicale.question } : undefined,
  };
}

export { charger, enregistrer };
