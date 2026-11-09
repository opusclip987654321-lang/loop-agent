// Les étapes du cycle d'une idée (ordre décidé par Walid le 09/11/2026) :
// Planification → Priorités → Exécution → Vérification → Révision → Mémoire.
// Les agents oubliaient de faire avancer leurs idées (190 sur 277 restées en Planification au
// 09/11) : Loop Agent les fait avancer lui-même, d'après ce qui se passe vraiment :
//   - Walid valide l'idée                         → Priorités
//   - l'agent écrit un tour sur l'action          → Exécution
//   - l'agent enregistre un résultat mesuré       → Vérification
//   - Walid répond sur l'idée après la vérif.     → Révision
//   - l'agent note la leçon                       → Mémoire
// On n'avance jamais à reculons tout seul ; l'agent peut encore choisir un stade lui-même.

export const STAGES = ['Planification', 'Priorités', 'Exécution', 'Vérification', 'Révision', 'Mémoire'];
const rang = (s) => Math.max(0, STAGES.indexOf(s));

export const active = (i) => i && typeof i === 'object' && !i.dropped && i.approvalStatus !== 'pending' && i.approvalStatus !== 'rejected';

// Fait avancer l'idée jusqu'à « stade » si elle est derrière. Renvoie true si elle a bougé.
export function avancer(idea, stade, jour) {
  if (!active(idea) || rang(idea.latestStage) >= rang(stade)) return false;
  idea.latestStage = stade;
  (idea.stageHistory = idea.stageHistory || []).push({ stage: stade, at: jour, auto: true });
  return true;
}

// Ce que Walid a fait depuis le dernier passage : validation, réponse après la vérification.
export function synchroniser(t, jour) {
  let n = 0;
  for (const i of t.ideas || []) {
    if (!active(i)) continue;
    if (i.latestStage === 'Planification' && i.approvalStatus === 'approved' && i.source === 'IA') n += avancer(i, 'Priorités', jour);
    if (i.latestStage === 'Vérification' && i.walidReply && i.walidReplyAt) {
      const entree = [...(i.stageHistory || [])].reverse().find((h) => h.stage === 'Vérification');
      if (!entree || !entree.at || String(i.walidReplyAt).slice(0, 10) >= entree.at) n += avancer(i, 'Révision', jour);
    }
  }
  return n;
}

// L'agent a travaillé l'action : ses idées (celles qu'il cite, sinon toutes les actives) passent en Exécution.
export function apresTour(t, indexCites, jour) {
  const cibles = indexCites.length ? indexCites.map((k) => t.ideas[k]).filter(Boolean) : t.ideas || [];
  let n = 0;
  for (const i of cibles) n += avancer(i, 'Exécution', jour);
  return n;
}

// Un résultat mesuré : les idées en cours passent en Vérification.
export function apresResultat(t, jour) {
  let n = 0;
  for (const i of t.ideas || []) if (i.latestStage === 'Exécution') n += avancer(i, 'Vérification', jour);
  return n;
}

// Une leçon notée : les idées vérifiées (ou revues par Walid) passent en Mémoire.
export function apresLecon(t, jour) {
  let n = 0;
  for (const i of t.ideas || []) if (i.latestStage === 'Vérification' || i.latestStage === 'Révision') n += avancer(i, 'Mémoire', jour);
  return n;
}

// Résumé pour la carte d'une action : combien d'idées à chaque étape.
export function resumeStades(t) {
  const c = {};
  for (const i of t.ideas || []) if (active(i)) c[i.latestStage || 'Planification'] = (c[i.latestStage || 'Planification'] || 0) + 1;
  return STAGES.filter((s) => c[s]).map((s) => ({ stade: s, idees: c[s] }));
}

// Garde-fou (Walid, 09/11/2026) : ce que l'agent doit rattraper avant son travail du jour,
// pour que rien d'appris ne se perde d'un tour à l'autre.
export function aFaireDAbord(t, nowMs = Date.now()) {
  const out = [];
  const jours = (d) => (d ? Math.floor((nowMs - Date.parse(String(d).length === 10 ? d + 'T12:00:00Z' : d)) / 86400000) : 0);
  (t.ideas || []).forEach((i, index) => {
    if (!active(i) || (i.latestStage !== 'Vérification' && i.latestStage !== 'Révision')) return;
    const depuis = [...(i.stageHistory || [])].reverse().find((h) => h.stage === i.latestStage);
    if (depuis && jours(depuis.at) >= 3)
      out.push(`Idée ${index} « ${String(i.text || '').slice(0, 80)} » : jugée (${i.latestStage}) depuis le ${depuis.at.split('-').reverse().join('/')}, toujours sans leçon. Note ce qu'elle a appris avec noter_lecon (chiffres à l'appui), même si c'est « pas assez de données ».`);
  });
  const r = (t.results || [])[0];
  if (r && r.at && (!t.lastAgentTurn || Date.parse(r.at) - Date.parse(t.lastAgentTurn) > 2 * 3600000))
    out.push(`Un résultat a été mesuré le ${r.at.slice(0, 10).split('-').reverse().join('/')} sans compte rendu après : écris-le avec ecrire_tour (ce que tu as fait, ce que tu en conclus).`);
  return out;
}
