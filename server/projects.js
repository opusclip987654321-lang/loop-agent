// Les projets de Loop Agent (cadrage §2, + Impacteur Communauté ajouté le 07/11/2026).
// Seuls les projets qui ont une boucle entrent ici. Les données de chaque
// projet (actions, idées, mémoire…) vivent dans la base, pas dans ce fichier.

export const PROJECTS = [
  {
    id: 'impacteur-mail',
    name: 'Email interview Impacteur',
    type: 'Automatisation (5 workflows n8n)',
    kind: 'automation',
    description: 'Trouve des auteurs et des invités à interviewer, rédige l’invitation et l’envoie.',
  },
  {
    id: 'impacteur-sponsors',
    name: 'Impacteur Sponsors',
    type: 'Espace admin + loop quotidienne',
    kind: 'prospection',
    description: 'Trouve chaque jour des marques à démarcher pour des campagnes sur Impacteur Afrique.',
  },
  {
    id: 'impacteur-communaute',
    name: 'Impacteur Communauté',
    type: 'Audience Instagram / TikTok → Patreon',
    kind: 'community',
    description: 'Transforme les abonnés Instagram et TikTok d’Impacteur en soutiens Patreon : bios et liens, image personnelle, messages aux abonnés (écrits par l’agent, envoyés par Walid), suivi des inscriptions.',
  },
  {
    id: 'extrait-politique',
    name: 'L’Extrait politique',
    type: 'Chaîne YouTube automatisée',
    kind: 'youtube',
    description: 'Repère les moments forts de l’actualité politique et publie Shorts et vidéo longue.',
    paused: true,
    pausedSince: '2026-10-19',
  },
  {
    id: 'cambodge',
    name: 'Agent Cambodge emploi',
    type: 'Agent (tâche programmée)',
    kind: 'agent',
    description: 'Cherche chaque matin des offres d’emploi au Cambodge, les note et propose les relances.',
  },
  {
    id: 'vegebudget',
    name: 'VégéBudget',
    type: 'Site web avec abonnement mensuel',
    kind: 'vegebudget',
    description: 'Aide à préparer des repas végétaux économiques, avec recettes et liste de courses.',
  },
  {
    id: 'leviaro',
    name: 'Leviaro',
    type: 'Site web de prospection commerciale',
    kind: 'website',
    description: 'Présente des prestations aux sociétés et facilite la prospection de clients professionnels.',
  },
  {
    id: 'petites-histoires',
    name: 'Petites Histoires Vraies',
    type: 'Chaîne YouTube format stickman',
    kind: 'youtube',
    description: 'Raconte des histoires vraies avec des animations stickman.',
  },
  {
    id: 'nourmeet',
    name: 'Nūr Meet',
    type: 'Site et application de rencontres',
    kind: 'webapp',
    description: 'Aide les personnes à se rencontrer autour d’activités et de sorties.',
  },
];

const IDS = new Set(PROJECTS.map((p) => p.id));

// Clés de documents acceptées : un document par projet, plus la page Argent.
export function isValidDocKey(key) {
  if (key === 'money') return true;
  const m = /^project:([a-z0-9-]+)$/.exec(key);
  return !!m && IDS.has(m[1]);
}
