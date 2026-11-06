// Contenu de départ d'un projet, identique à ce que crée l'interface
// (public/app.js : projectDefaults + permanentLoops). Utilisé quand un agent
// écrit dans un projet que personne n'a encore ouvert dans le navigateur.

const LOOP_DEFS = [
  {
    suffix: 'mails',
    title: 'Lire les réponses reçues',
    goal: 'Savoir ce que les gens répondent vraiment, pour nourrir la mémoire du projet.',
    metric: 'Vraies réponses humaines classées',
    freq: 'Chaque jour',
    ideas: [
      'Lire les boîtes qui concernent ce projet',
      'Classer : refus, question, rendez-vous, absence',
      'Écarter les réponses automatiques et les boîtes pleines',
      'Verser le constat en mémoire',
    ],
  },
  {
    suffix: 'stats',
    title: 'Surveiller les statistiques',
    goal: 'Comparer les résultats dans le temps et créer une action quand un écart le justifie.',
    metric: 'Écarts repérés et actions créées',
    freq: 'Chaque jour',
    ideas: [
      'Relever les chiffres de la période',
      'Comparer aux périodes précédentes',
      'Repérer ce qui change vraiment',
      'Proposer une action si l’écart le justifie',
    ],
  },
  {
    suffix: 'veille',
    title: 'Veille extérieure',
    goal: 'Repérer ailleurs ce qui mérite d’être essayé ici.',
    metric: 'Pistes retenues et testées',
    freq: 'Chaque semaine',
    ideas: [
      'Observer ce que font les autres sur ce terrain',
      'Repérer les formats et méthodes qui marchent',
      'Évaluer ce qui est transposable ici',
      'Proposer un test',
    ],
  },
];

export function newIdea(taskId, index, text, extra = {}) {
  return {
    id: `${taskId}-idea-${index}`,
    text,
    latestStage: 'Planification',
    stageHistory: [],
    agentComment: '',
    walidReply: '',
    ...extra,
  };
}

export function permanentLoops(project) {
  return LOOP_DEFS.map((d) => {
    const id = `${project.id}-${d.suffix}`;
    return {
      id,
      title: d.title,
      origin: 'Agent',
      owner: 'Agent',
      goal: d.goal,
      metric: d.metric,
      status: project.paused ? 'En pause' : 'En cours',
      type: 'Boucle',
      freq: d.freq,
      category: 'Autre',
      autonomy: 'autonome',
      permanent: true,
      paused: false,
      reviewCadence: 'Chaque lundi',
      reviewState: 'À examiner par l’agent',
      reviewHistory: [],
      reviewConversation: [],
      ideas: d.ideas.map((text, i) => newIdea(id, i, text)),
    };
  });
}

export function defaultProjectDoc(project) {
  const tasks = permanentLoops(project);
  return {
    projectKind: project.kind,
    tasks,
    priorities: tasks.map((t) => t.id),
    method: false,
    notes: {},
    ideas: [],
    memories: [],
    rules: [],
    quota: 2,
    themes: [],
    themeSignals: {},
    prompt: {
      structure: 'Accroche → contexte → développement → conclusion',
      tone: 'Clair, accessible et adapté au projet',
      voice: 'Voix française naturelle',
    },
    queue: {},
  };
}

export function defaultMoneyDoc() {
  return { expenses: [], invoices: [], corrections: [], ai: [] };
}
