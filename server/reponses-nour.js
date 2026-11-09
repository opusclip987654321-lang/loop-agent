// Tri des réponses des restaurants à la prospection Nūr Meet (reprise du cerveau central,
// décision de Walid du 09/11/2026).
// 1. Le relevé horaire du serveur Nūr (scripts/nour-meet-releve.py) envoie les réponses reçues
//    (np_reponses de n8n), coupées avant la citation du mail d'origine, adresses et téléphones
//    masqués. Elles attendent ici, dans le document « nour-reponses ».
// 2. Une tâche Claude (abonnement) les lit avec reponses_a_trier et les classe avec trier_reponses,
//    avec la même consigne que le cerveau. Après le tri, le texte est effacé : il ne reste que
//    le type, un résumé d'une phrase, le jour et le nom du restaurant.
// 3. Un restaurant intéressé ou qui pose une question devient une demande à Walid (action
//    « Lire les réponses reçues » du projet nourmeet) ; l'indicateur « Réponses intéressées »
//    est recalculé.

export const KEY = 'nour-reponses';
export const ACTION = 'nourmeet-mails';
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const CLE = /^[a-f0-9]{16}$/;

export const TYPES_REPONSE = {
  INTERESSE: 'intéressé (veut parler, rappel, rendez-vous)',
  QUESTION: 'pose une question (prix, fonctionnement…)',
  REFUS: 'refus ou « stop »',
  AUTOMATIQUE: 'message automatique ou adresse morte',
  AUTRE: 'autre',
};
export const POSITIFS = new Set(['INTERESSE', 'QUESTION']);

export const CONSIGNE_TRI = `Tu tries les réponses de restaurants à un mail de prospection de Nūr Meet (soirées rencontre et networking organisées dans des restaurants, abonnement mensuel pour le restaurant).
Pour chaque réponse, donne son type :
- INTERESSE : veut en parler, demande un rappel ou un rendez-vous, donne un numéro, dit être intéressé ;
- QUESTION : pose une vraie question (prix, fonctionnement, clientèle…) sans dire non ;
- REFUS : refuse, demande d'arrêter, « stop » ;
- AUTOMATIQUE : accusé de réception, absence, adresse inexistante, publicité automatique pour le restaurant, réaction emoji ;
- AUTRE : le reste (transmis à l'équipe, devis…).
Puis appelle trier_reponses avec, pour chaque réponse : cle, type, resume (une phrase en français, sans adresse ni téléphone).`;

// Masque ce qui permet de joindre quelqu'un : Loop Agent n'en a pas besoin, Walid a le mail d'origine.
export function masquer(s) {
  return String(s || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[adresse masquée]')
    .replace(/(?:\+|00)?\d[\d .\-()]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[téléphone masqué]' : m));
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? masquer(v).trim().slice(0, max) : null);

// Ne garde que les champs attendus, bornés et masqués.
export function nettoyerReponses(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, 80)) {
    if (!r || !CLE.test(String(r.cle)) || !JOUR.test(String(r.jour))) continue;
    const texte = str(r.texte, 800);
    const objet = str(r.objet, 150);
    if (!texte && !objet) continue;
    out.push({ cle: r.cle, jour: r.jour, nom: str(r.nom, 80), ville: str(r.ville, 40), objet, texte });
  }
  return out;
}

const vide = () => ({ aTrier: {}, triees: {} });

// Ajoute les réponses pas encore connues ; oublie les textes non triés de plus de 30 jours.
export function ajouterATrier(etat, reponses, today) {
  etat.aTrier = etat.aTrier || {};
  etat.triees = etat.triees || {};
  let n = 0;
  for (const r of reponses) {
    if (etat.triees[r.cle] || etat.aTrier[r.cle]) continue;
    etat.aTrier[r.cle] = r;
    n++;
  }
  const limite = new Date(Date.parse(today + 'T12:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
  for (const [k, r] of Object.entries(etat.aTrier)) if (r.jour < limite) delete etat.aTrier[k];
  return n;
}

export function enregistrerATrier(db, reponses, today) {
  if (!reponses.length) return 0;
  for (let i = 0; i < 5; i++) {
    const cur = db.getDoc(KEY);
    const etat = cur ? JSON.parse(cur.value) : vide();
    const n = ajouterATrier(etat, reponses, today);
    if (!n && cur) return 0;
    if (db.putDoc(KEY, JSON.stringify(etat), cur ? cur.version : 0, 'agent:releve-n8n').ok) return n;
  }
  throw new Error('Document occupé, réessaie.');
}

export function lireEtat(db) {
  const cur = db.getDoc(KEY);
  return cur ? JSON.parse(cur.value) : vide();
}

// Range le tri : renvoie les réponses nouvellement triées (sans texte), plus le texte pour la demande.
export function noterTri(etat, tries, nowIso) {
  const nouvelles = [];
  for (const x of Array.isArray(tries) ? tries : []) {
    const r = x && etat.aTrier[x.cle];
    if (!r || !TYPES_REPONSE[x.type]) continue;
    const resume = masquer(String(x.resume || '')).replace(/\s+/g, ' ').trim().slice(0, 300);
    etat.triees[x.cle] = { type: x.type, resume, jour: r.jour, nom: r.nom, ville: r.ville, trie: nowIso };
    delete etat.aTrier[x.cle];
    nouvelles.push({ ...etat.triees[x.cle], cle: x.cle, objet: r.objet, texte: r.texte });
  }
  return nouvelles;
}

// Nombre de réponses positives par jour de réception (un restaurant compte une fois par jour).
export function positifsParJour(etat) {
  const vus = new Map();
  for (const r of Object.values(etat.triees || {})) {
    if (!POSITIFS.has(r.type)) continue;
    const k = r.jour + '|' + (r.nom || r.resume);
    vus.set(k, r.jour);
  }
  const parJour = {};
  for (const j of vus.values()) parJour[j] = (parJour[j] || 0) + 1;
  return parJour;
}

// Ce que lire_projet montre à l'agent Nūr Meet.
export function resumePourAgent(etat) {
  const types = {};
  for (const r of Object.values(etat.triees || {})) types[r.type] = (types[r.type] || 0) + 1;
  const a = Object.keys(etat.aTrier || {}).length;
  return {
    a_trier: a,
    consigne: a ? 'Des réponses de restaurants attendent : appelle reponses_a_trier, classe-les, puis trier_reponses.' : undefined,
    triees_par_type: types,
    dernieres: Object.values(etat.triees || {})
      .sort((x, y) => (y.jour > x.jour ? 1 : y.jour < x.jour ? -1 : 0))
      .slice(0, 20)
      .map((r) => ({ jour: r.jour, restaurant: r.nom || 'inconnu', type: r.type, resume: r.resume })),
  };
}
