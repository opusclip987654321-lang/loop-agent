// Les projets de Loop Agent (cadrage §2, + Impacteur Communauté ajouté le 07/11/2026,
// + Gestion Immo et banque ajouté le 11/11/2026).
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
  {
    id: 'ebook',
    name: 'Ebook',
    type: 'Création et vente d’ebooks',
    kind: 'ebook',
    description: 'Toute la chaîne d’un ebook : sujet, écriture, couverture, mise en page, page de vente, mise en vente et promotion.',
  },
  {
    id: 'gestion-loop-agent',
    name: 'Gestion de Loop Agent',
    type: 'Amélioration de Loop Agent lui-même',
    kind: 'meta',
    description: 'Remet en question l’organisation de Loop Agent : ce que Walid répète, ce qui n’a pas de place, les onglets qui manquent.',
    extraLoops: [
      {
        suffix: 'organisation',
        title: 'Remettre en question l’organisation de Loop Agent',
        goal: 'Repérer ce qui manque ou se répète dans Loop Agent, et proposer de l’améliorer.',
        metric: 'Améliorations proposées puis adoptées par Walid',
        freq: 'Chaque semaine',
        ideas: [
          'Relever les commentaires que Walid fait trop souvent sur ses projets et qu’on peut automatiser',
          'Repérer les informations importantes pour lesquelles aucune place n’est prévue dans le site',
          'Repérer les sujets non traités qui mériteraient un onglet',
          'Proposer chaque amélioration avec les 5 points',
        ],
      },
    ],
  },
  {
    id: 'gestion-immo-banque',
    name: 'Gestion Immo et banque',
    type: 'Suivi des finances, de l’immobilier et du courrier',
    kind: 'finance',
    description: 'Garde sous contrôle les finances de Walid et ses projets immobiliers, prépare les mails aux bonnes personnes (envoyés par Walid) et s’appuie sur des recherches juridiques (Doctrine).',
    extraLoops: [
      {
        suffix: 'finances',
        title: 'Suivre les finances',
        goal: 'Savoir chaque mois où en sont les comptes et repérer ce qui dérape avant que ça coûte.',
        metric: 'Écarts repérés et traités',
        freq: 'Chaque semaine',
        ideas: [
          'Relever les soldes et les grosses dépenses de la période',
          'Comparer au mois précédent et au budget',
          'Repérer les prélèvements inattendus ou les frais bancaires',
          'Proposer une action si un écart le justifie',
        ],
      },
      {
        suffix: 'immo',
        title: 'Suivre les projets immobiliers',
        goal: 'Que chaque projet immobilier ait sa prochaine étape, son échéance et la personne à relancer.',
        metric: 'Projets immobiliers avec prochaine étape et échéance à jour',
        freq: 'Chaque semaine',
        ideas: [
          'Lister les projets immobiliers en cours et leur étape',
          'Noter les échéances (prêt, notaire, travaux, loyers, impôts)',
          'Préparer les mails aux bonnes personnes (banque, notaire, agence, artisans), envoyés par Walid',
          'Signaler à Walid ce qui attend sa décision',
        ],
      },
      {
        suffix: 'droit',
        title: 'Recherches juridiques',
        goal: 'Fonder chaque décision ou mail sensible sur le droit applicable, avec ses sources.',
        metric: 'Questions juridiques traitées avec sources citées',
        freq: 'À la demande',
        ideas: [
          'Noter les questions juridiques des projets (bail, copropriété, fiscalité, crédit)',
          'Chercher la réponse sur Doctrine (accès de Walid) et dans les textes officiels',
          'Résumer la règle en mots simples, avec ses sources',
          'Verser la réponse en mémoire pour ne pas refaire la recherche',
        ],
      },
    ],
  },
];

const IDS = new Set(PROJECTS.map((p) => p.id));

// Clés de documents acceptées : un document par projet, plus la page Argent.
export function isValidDocKey(key) {
  if (key === 'money') return true;
  const m = /^project:([a-z0-9-]+)$/.exec(key);
  return !!m && IDS.has(m[1]);
}
