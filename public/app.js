// Interface de Loop Agent, issue de atelier-maquette.html (transformation : tools/transform-maquette.mjs).
const pages = ['Planification', 'Exécution', 'Vérification', 'Mémoire', 'Priorités', 'Révision'],
  slugs = ['planification', 'execution', 'verification', 'memoire', 'priorites', 'revision'];
const moneyPage = { name: 'Argent', slug: 'argent' },
  categories = ['Site web', 'Application mobile', 'Réseaux sociaux', 'SEO', 'Design', 'Prospection', 'Autre'],
  formats = ['Short', 'Vidéo longue', 'Publication Communauté'];
const socialNetworks = [
  { id: 'instagram', platform: 'Instagram', target: 1000, current: 0, monthlyViews: 0, followersGained: 0 },
  { id: 'tiktok', platform: 'TikTok', target: 10000, current: 0, monthlyViews: 0, followersGained: 0 },
  { id: 'youtube', platform: 'YouTube', target: 1000, current: 0, monthlyViews: 0, followersGained: 0 },
  { id: 'facebook', platform: 'Facebook', target: 10000, current: 0, monthlyViews: 0, followersGained: 0 },
];
// Les projets viennent du serveur ; leurs données démarrent vides (cadrage : démarrage vide).
const projects = LA.projects.map((p) => ({ ...p, tasks: [], ideas: [], memories: [] }));
function executionPlan(owner) {
  return owner === 'Agent'
    ? 'Claude choisira l’agent spécialisé et l’outil adapté à la tâche.'
    : 'Action réalisée par Walid.';
}
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const projectKey = (id) => 'project:' + id;
let projectId = localStorage.getItem('agent-workspace-selected') || 'vegebudget';
if (!projects.some((p) => p.id === projectId)) projectId = 'vegebudget';
let projectDef = projects.find((p) => p.id === projectId);
function projectDefaults(id) {
  let p = projects.find((x) => x.id === id),
    tasks = p.tasks.map((t) => ({
      ...t,
      ideas: t.ideas
        ? t.ideas.map((idea, i) =>
            typeof idea === 'string'
              ? {
                  id: t.id + '-idea-' + i,
                  text: idea,
                  latestStage: 'Planification',
                  stageHistory: [],
                  agentComment: '',
                  walidReply: '',
                }
              : { ...idea },
          )
        : (t.steps || []).map((text, i) => ({
            id: t.id + '-idea-' + i,
            text,
            latestStage: 'Planification',
            stageHistory: [],
            agentComment: '',
            walidReply: '',
          })),
    }));
  return {
    projectKind: p.kind,
    tasks,
    priorities: tasks.map((t) => t.id),
    method: false,
    notes: {},
    ideas: [...p.ideas],
    memories: [...p.memories],
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
function loadProject(id) {
  let p = projects.find((x) => x.id === id),
    raw = null;
  try {
    raw = LA.get(projectKey(id));
  } catch {}
  let d;
  try {
    d = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!d) d = projectDefaults(id);
  let base = projectDefaults(id);
  d.projectKind = p.kind;
  d.tasks = d.tasks || base.tasks;
  d.notes = d.notes || {};
  for (const seed of base.tasks) {
    let found = d.tasks.find((t) => t.id === seed.id);
    if (!found) {
      found = seed;
      d.tasks.push(found);
    } else
      Object.keys(seed).forEach((k) => {
        if (found[k] === undefined) found[k] = seed[k];
      });
    if (seed.reviewHistory && !found.reviewHistory) found.reviewHistory = seed.reviewHistory.map((x) => ({ ...x }));
    if (Array.isArray(seed.ideas)) {
      found.ideas = found.ideas || [];
      seed.ideas
        .filter((i) => typeof i === 'object' && i.source === 'IA' && i.id)
        .forEach((i) => {
          if (!found.ideas.some((x) => x && x.id === i.id)) found.ideas.push({ ...i });
        });
    }
  }
  permanentLoops(id, p.name).forEach((seed) => {
    if (!d.tasks.some((t) => t.id === seed.id)) {
      let c = JSON.parse(JSON.stringify(seed));
      if (p.paused) c.status = 'En pause';
      d.tasks.push(c);
    }
  });
  d.priorities = d.priorities || [];
  d.tasks.forEach((t) => {
    if (!t.ideas)
      t.ideas = (t.steps || []).map((text, i) => ({
        id: t.id + '-idea-' + i,
        text,
        latestStage: 'Planification',
        stageHistory: [],
        agentComment: '',
        walidReply: '',
      }));
    else
      t.ideas = t.ideas.map((idea, i) =>
        typeof idea === 'string'
          ? {
              id: t.id + '-idea-' + i,
              text: idea,
              latestStage: 'Planification',
              stageHistory: [],
              agentComment: '',
              walidReply: '',
            }
          : idea,
      );
    if (!d.priorities.includes(t.id)) d.priorities.push(t.id);
    if (t.paused === undefined) t.paused = false;
    if (!t.category) t.category = t.id === 'social' ? 'Réseaux sociaux' : 'Site web';
    if (!Array.isArray(t.accessRequests) && t.requiresMeta)
      t.accessRequests = [
        {
          id: 'meta',
          name: 'Meta',
          message: t.metaRequest || 'L’agent a besoin d’un accès Meta pour diffuser les contenus de cette tâche.',
        },
      ];
    delete t.requiresMeta;
    delete t.metaRequest;
    if (t.id === 'social') {
      let targetIdea = t.ideas.find((i) => (typeof i === 'string' ? i : i.text) === 'Créer les premières publications');
      if (targetIdea && typeof targetIdea === 'string') {
        targetIdea = t.ideas[t.ideas.indexOf(targetIdea)] = {
          text: targetIdea,
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        };
      }
      let reqs = Array.isArray(t.accessRequests) ? t.accessRequests : [];
      if (targetIdea) {
        targetIdea.accessRequests =
          targetIdea.accessRequests || reqs.length
            ? targetIdea.accessRequests || reqs
            : [
                {
                  id: 'meta',
                  name: 'Meta',
                  message: 'L’agent a besoin de l’accès Meta pour publier ce contenu sur les réseaux sociaux.',
                },
              ];
      }
    }
    delete t.accessRequests;
    if (t.freq === 'Suivi hebdomadaire' || t.freq === 'Chaque semaine') t.freq = 'Chaque lundi';
    if (!t.reviewCadence) t.reviewCadence = t.type === 'Ponctuelle' || t.format ? 'Chaque jour' : 'Chaque lundi';
    if (!t.reviewState) t.reviewState = 'À examiner par l’agent';
    if (!Array.isArray(t.reviewHistory)) t.reviewHistory = [];
    if (!Array.isArray(t.reviewConversation)) t.reviewConversation = [];
    (t.reviewHistory || []).forEach((entry) => {
      if (entry.walidComment) {
        t.reviewConversation.push({ role: 'Walid', date: entry.date, text: entry.walidComment });
        delete entry.walidComment;
      }
    });
    delete t.channel;
    delete t.targetChannels;
    t.ideas.forEach((idea, i) => {
      if (!idea.latestStage) idea.latestStage = 'Planification';
      if (!Array.isArray(idea.stageHistory))
        idea.stageHistory = idea.latestStage === 'Planification' ? [] : [{ stage: idea.latestStage, at: null }];
      if (idea.agentComment === undefined)
        idea.agentComment =
          t.id === 'tunnel' && i === 0
            ? 'Je n’ai pas encore lancé cette piste : le suivi des étapes du tunnel n’est pas configuré. Sans ces données, je ne peux pas mesurer où les visiteurs abandonnent.'
            : '';
      if (idea.walidReply === undefined) idea.walidReply = '';
    });
  });
  d.ideas = d.ideas || base.ideas;
  d.memories = d.memories || base.memories;
  for (const seedMemory of base.memories) {
    let existing = d.memories.find((m) => m.title === seedMemory.title);
    if (!existing) d.memories.push({ ...seedMemory });
    else
      Object.keys(seedMemory).forEach((k) => {
        if (existing[k] === undefined) existing[k] = seedMemory[k];
      });
  }
  d.queue = d.queue || {};
  d.telegramAlerts = !!d.telegramAlerts;
  d.rules = d.rules || base.rules;
  d.prompt = d.prompt || base.prompt;
  d.themes = d.themes || base.themes;
  d.themeSignals = d.themeSignals || base.themeSignals;
  d.quota = d.quota ?? base.quota;
  if (id === 'vegebudget') {
    d.followers = d.followers || socialNetworks.map((n) => ({ ...n }));
    for (const n of socialNetworks) if (!d.followers.some((x) => x.id === n.id)) d.followers.push({ ...n });
  }
  saveData(id, d);
  return d;
}
let data = loadProject(projectId);
function saveData(id, d) {
  try {
    LA.set(projectKey(id), JSON.stringify(d));
  } catch {}
}
function selectProject(id) {
  if (!projects.some((p) => p.id === id)) return;
  if (id === projectId) {
    closeDialog();
    return;
  }
  save();
  projectId = id;
  projectDef = projects.find((p) => p.id === id);
  try {
    localStorage.setItem('agent-workspace-selected', id);
  } catch {}
  data = loadProject(id);
  categoryFilter = 'Toutes';
  sourceFilter = 'Toutes';
  ideaFilter = 'Toutes';
  memoryFilter = 'Toutes';
  window.query = '';
  closeDialog();
  render();
  notify('Espace ' + projectDef.name + ' ouvert. Les données des projets restent séparées.');
}
function openProjectPicker() {
  modal(
    'Choisir un projet',
    `<p class="note">Un point doré signale que quelque chose t’attend dans le projet. Un point gris : projet en pause.</p><div class="grid">${projects
      .map((p) => {
        let c = p.id === projectId ? projectColor(data) : projectColorFor(p.id);
        return `<button style="text-align:left;padding:17px" onclick="selectProject('${p.id}')"><span class="tiny">${colorDot(c)}${esc(p.type)}</span><h3>${esc(p.name)}</h3><p class="note">${esc(p.description)}</p>${p.id === projectId ? pill('Projet actif') : ''}</button>`;
      })
      .join('')}</div>`,
  );
}
let page = 0,
  categoryFilter = 'Toutes',
  sourceFilter = 'Toutes',
  ideaFilter = 'Toutes',
  memoryFilter = 'Toutes',
  main = document.getElementById('main');
function save() {
  saveData(projectId, data);
}
function notify(s) {
  let t = document.getElementById('toast');
  t.textContent = s;
  t.hidden = false;
  clearTimeout(window.tt);
  window.tt = setTimeout(() => (t.hidden = true), 5000);
}
function pill(s) {
  let c = /Programmé|Approuvé|Validé|Terminé|Top performance|Hook efficace/.test(s)
    ? 'green'
    : /Flop|Rejeté|Bloqué/.test(s)
      ? 'red'
      : /attente|À valider|Proposée/.test(s)
        ? 'yellow'
        : 'gold';
  return `<span class="badge ${c}">${esc(s)}</span>`;
}
function btn(text, code, cls = '') {
  return `<button class="${cls}" onclick="${code}">${text}</button>`;
}
function go(i) {
  location.hash = slugs[i];
}
function task(id) {
  return data.tasks.find((t) => t.id === id);
}
function modal(title, html) {
  document.getElementById('dialogtitle').textContent = title;
  document.getElementById('dialogbody').innerHTML = html;
  document.getElementById('dialog').showModal();
}
function closeDialog() {
  document.getElementById('dialog').close();
}
document.getElementById('dialog').addEventListener('click', (e) => {
  if (e.target.id === 'dialog') closeDialog();
});
function head(title, desc, action = '') {
  return `<div class="heading"><div><h1>${title}</h1><p class="intro">${desc}</p></div>${action}</div>`;
}
function cardTask(t) {
  const w = waitReasons(t);
  const kinds = w.map((x) => x.kind);
  const cls = taskColor(t) === 'rouge' ? 'cwait' : isPaused(t) ? 'cgrey' : '';
  let acts = '';
  if (kinds.includes('objectif')) acts += btn('Fixer l’objectif', `editObjective('${t.id}')`, 'wait');
  else if (kinds.includes('objectif-suggere')) acts += btn('Confirmer l’objectif', `editObjective('${t.id}')`, 'wait');
  acts += btn('Ouvrir', `detail('${t.id}')`);
  return `<article class="card acard ${cls}">${cardHead(t)}<h3>${esc(t.title)}</h3>${
    t.goal ? `<p class="adesc">${esc(t.goal)}</p>` : ''
  }${t.targetFollowers ? `<p class="note">Cible : ${Number(t.targetFollowers).toLocaleString('fr-FR')} abonnés</p>` : ''}${stopBanner(t)}${proposalCard(
    t,
  )}<div class="actions">${acts}</div></article>`;
}
function setTaskProposal(id, approved) {
  let t = task(id);
  if (!t) return;
  t.proposalStatus = approved ? 'approved' : 'rejected';
  t.status = approved ? 'À planifier' : 'Action refusée par Walid';
  save();
  render();
  notify(
    approved ? 'Nouvelle action validée : l’IA peut la lancer quand elle le décide.' : 'Proposition d’action refusée.',
  );
}
function ideaCard(i) {
  return `<article class="card"><div class="toolbar" style="margin:0 0 9px">${pill(i.status)}<span class="badge">${esc(i.format || 'Short')}</span></div><h3>${esc(i.title)}</h3><p><strong>Hook</strong> · ${esc(i.hook)}</p><p class="note">Niche : ${esc(i.niche)}</p><div class="actions">${i.status !== 'Approuvé par Walid' ? btn('Approuver', `setIdea('${i.id}','Approuvé par Walid')`, 'good') : ''}${i.status !== 'Rejeté' ? btn('Rejeter', `setIdea('${i.id}','Rejeté')`, 'danger') : ''}</div></article>`;
}
function ideaPanel() {
  if (data.projectKind !== 'youtube') return '';
  let ideas = data.ideas.filter((i) => ideaFilter === 'Toutes' || i.status === ideaFilter);
  return `<section class="card space"><div class="heading" style="margin-bottom:8px"><div><h2>Bac à idées · Pipeline de sujets</h2><p class="note">Walid approuve ou rejette chaque idée avant sa transformation en action.</p></div>${btn('+ Ajouter une idée', 'newIdea()')}</div><div class="toolbar">${['Toutes', 'Idée proposée par l’agent', 'Approuvé par Walid', 'Rejeté'].map((f) => btn(f, `setIdeaFilter('${f}')`, ideaFilter === f ? 'active' : '')).join('')}</div><div class="grid">${ideas.map(ideaCard).join('') || '<div class="empty">Aucune idée dans ce statut.</div>'}</div></section>`;
}
function pendingApprovalCount() {
  return data.tasks.reduce(
    (n, t) =>
      n +
      (t.proposalStatus === 'pending' ? 1 : 0) +
      (t.ideas || []).filter((i) => i && typeof i === 'object' && i.source === 'IA' && i.approvalStatus === 'pending')
        .length,
    0,
  );
}
function telegramPanel() {
  let count = pendingApprovalCount();
  return `<section class="card space"><div class="heading" style="margin-bottom:0"><div><span class="tiny">ALERTES DE VALIDATION</span><h2 style="margin:5px 0">Notifications Telegram</h2><p class="note">${count ? count + ' proposition(s) attendent ta réponse.' : 'Tu recevras un rappel quand une proposition attendra ta réponse.'}</p></div><div>${pill(data.telegramAlerts ? 'Simulation active' : 'À connecter')}<div class="actions">${btn(data.telegramAlerts ? 'Désactiver la simulation' : 'Activer les alertes Telegram', 'toggleTelegramAlerts()', data.telegramAlerts ? '' : 'primary')}</div></div></div><p class="note">La maquette simule les alertes par projet. Le bot Telegram réel reste à connecter.</p></section>`;
}
function toggleTelegramAlerts() {
  data.telegramAlerts = !data.telegramAlerts;
  save();
  render();
  notify(
    data.telegramAlerts
      ? 'Simulation des alertes Telegram activée pour ce projet.'
      : 'Simulation des alertes Telegram désactivée.',
  );
}
// Phrase du bandeau : ce qui attend, regroupé par nature.
function waitingSummary(tasks) {
  const n = (k) => tasks.filter((t) => waitReasons(t).some((x) => x.kind === k)).length;
  const parts = [];
  const prop = n('proposition');
  if (prop) parts.push(prop > 1 ? `${prop} propositions de l’agent attendent ta réponse.` : 'Une proposition de l’agent attend ta réponse.');
  const first = n('premier');
  if (first) parts.push(first > 1 ? `${first} premiers résultats sont à valider.` : 'Un premier résultat est à valider.');
  const stop = n('modification');
  if (stop) parts.push(stop > 1 ? `${stop} actions sont arrêtées en attendant ta décision.` : 'Une action est arrêtée en attendant ta décision.');
  const idea = n('idee');
  if (idea) parts.push(idea > 1 ? `Des idées attendent ta décision dans ${idea} actions.` : 'Des idées attendent ta décision dans une action.');
  const obj = n('objectif');
  if (obj) parts.push(`${countWord(obj, 'action tourne', 'actions tournent')} sans objectif : l’agent ne peut rien en conclure.`);
  const sug = n('objectif-suggere');
  if (sug) parts.push(sug > 1 ? `${sug} objectifs suggérés par l’agent sont à confirmer.` : 'Un objectif suggéré par l’agent est à confirmer.');
  const rev = n('constat');
  if (rev) parts.push(rev > 1 ? `${rev} constats attendent ta validation en Révision.` : 'Un constat attend ta validation en Révision.');
  return parts.join(' ');
}
function countWord(n, one, many) {
  const w = ['', 'Une', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix'];
  return n === 1 ? `${w[1]} ${one}` : `${w[n] || n} ${many}`;
}
function planning() {
  const all = visibleTasks('planification');
  const waiting = all.filter((t) => taskColor(t) === 'rouge');
  const rank = (t) => (taskColor(t) === 'rouge' ? 0 : t.proposalStatus === 'rejected' ? 3 : isPaused(t) ? 2 : 1);
  let list = all
    .filter(
      (t) =>
        (categoryFilter === 'Toutes' || (categoryFilter === 'À traiter' ? taskColor(t) === 'rouge' : t.category === categoryFilter)) &&
        (sourceFilter === 'Toutes' ||
          (sourceFilter === 'Mes actions' && t.origin === 'Walid') ||
          (sourceFilter === 'Propositions des agents' && t.origin !== 'Walid')),
    )
    .sort((a, b) => rank(a) - rank(b));
  const used = categories.filter((c) => all.some((t) => t.category === c));
  const banner = waiting.length
    ? `<section class="strip wait banner"><div><strong>${countWord(waiting.length, 'chose t’attend ici', 'choses t’attendent ici')}</strong><p>${esc(
        waitingSummary(waiting),
      )}</p></div>${categoryFilter === 'À traiter' ? btn('Tout afficher', "setCategory('Toutes')") : btn('Traiter maintenant', "setCategory('À traiter')", 'wait')}</section>`
    : '';
  const filters = ['Toutes', ...(waiting.length ? ['À traiter'] : []), ...used];
  return (
    head('Planification', 'Les actions à mener pour ' + esc(projectDef.name) + '.', btn('Ajouter une action', 'newTask()')) +
    `${banner}${ideaPanel()}<div class="toolbar">${filters
      .map((f) => btn(f === 'À traiter' ? `À traiter · ${waiting.length}` : f, `setCategory('${f}')`, (categoryFilter === f ? 'active ' : '') + (f === 'À traiter' ? 'c-wait' : '')))
      .join('')}<span class="grow"></span>${['Toutes', 'Mes actions', 'Propositions des agents']
      .map((f) => btn(f === 'Toutes' ? 'Toutes origines' : f, `setSource('${f}')`, 'small ' + (sourceFilter === f ? 'active' : '')))
      .join('')}</div><div class="cards">${list.map(cardTask).join('') || '<div class="empty">Aucune action ici.</div>'}</div>`
  );
}
function setIdea(id, status) {
  let i = data.ideas.find((x) => x.id === id);
  if (i) {
    i.status = status;
    save();
    render();
    notify('Statut de la proposition mis à jour.');
  }
}
function setIdeaFilter(f) {
  ideaFilter = f;
  render();
}
function newIdea() {
  modal(
    'Ajouter un sujet au pipeline',
    `<form id="ideaform"><label>Titre</label><input id="ititle" required placeholder="Ex. comment constituer une épargne de précaution ?"><label>Hook de départ</label><input id="ihook" required placeholder="La première phrase qui arrête le scroll"><label>Niche</label><input id="iniche" required placeholder="Épargne, budget débutant…"><label>Format</label><select id="iformat">${formats.map((f) => `<option>${f}</option>`).join('')}</select><div class="actions"><button class="primary">Ajouter l’idée</button></div></form>`,
  );
  document.getElementById('ideaform').onsubmit = (e) => {
    e.preventDefault();
    data.ideas.unshift({
      id: 'idea-' + Date.now(),
      title: ititle.value,
      hook: ihook.value,
      niche: iniche.value,
      format: iformat.value,
      status: 'Idée proposée par l’agent',
    });
    save();
    closeDialog();
    render();
    notify('Sujet ajouté au pipeline.');
  };
}
const queueStates = [
  'En cours de génération script',
  'Génération voix/visuels',
  'Montage automatique',
  'En attente de validation Walid',
  'Programmé',
];
const toolMap = {
  social: [
    ['Claude', 'Instagram Insights'],
    ['Claude', 'Google Sheets'],
    ['Claude', 'Canva'],
    ['Meta Business Suite'],
    ['Instagram Insights', 'Google Analytics 4'],
  ],
};
function toolsForIdea(t, i) {
  return t.tools || toolMap[t.id]?.[i] || ['À choisir selon le besoin'];
}
function taskIdeaCards(t, showTools = false) {
  let ideas = t.ideas || [];
  let order = ideas.map((x, n) => n).sort((a, b) => (ideaIsRed(ideas[b]) ? 1 : 0) - (ideaIsRed(ideas[a]) ? 1 : 0));
  let banner = '';
  let reds = ideas.filter(ideaIsRed);
  if (reds.length)
    banner = `<section class="strip red"><strong>${colorDot('rouge')}${reds.length} idée${reds.length > 1 ? 's' : ''} attend${reds.length > 1 ? 'ent' : ''} ta décision</strong><ul style="margin:8px 0 0;padding-left:20px">${reds.map((i) => `<li>${esc(i.text)}${(i.accessRequests || []).some((a) => !a.connected) ? ' <span class="mwarn">— accès manquant</span>' : ' <span class="mwarn">— proposition de l’agent</span>'}</li>`).join('')}</ul><p class="tiny" style="margin-top:8px">Elles sont placées en premier ci-dessous.</p></section>`;
  return (
    banner +
      order
        .map((i) => {
          let idea = ideas[i];
          let text = typeof idea === 'string' ? idea : idea.text || '',
            stage = typeof idea === 'string' ? 'Planification' : idea.latestStage || 'Planification',
            history = typeof idea === 'string' ? [] : Array.isArray(idea.stageHistory) ? idea.stageHistory : [],
            agentComment = typeof idea === 'string' ? '' : idea.agentComment || '',
            reply = typeof idea === 'string' ? '' : idea.walidReply || '',
            access = typeof idea === 'string' ? [] : idea.accessRequests || [],
            isAI = typeof idea !== 'string' && idea.source === 'IA',
            approval = typeof idea === 'string' ? 'approved' : idea.approvalStatus || 'approved';
          let decision =
            isAI && approval === 'pending'
              ? `<div class="strip"><strong>Idée proposée par l’IA · validation requise</strong><div class="actions"><button class="good" onclick="setTaskIdeaApproval('${t.id}',${i},true,${showTools})">Valider l’idée</button><button class="danger" onclick="setTaskIdeaApproval('${t.id}',${i},false,${showTools})">Refuser</button></div></div>`
              : isAI && approval === 'approved'
                ? `<p class="note green">Idée validée par Walid · l’IA peut la lancer quand elle le décide.</p>`
                : isAI
                  ? `<p class="note red">Idée refusée par Walid.</p>`
                  : idea.source === 'Walid'
                    ? `<p class="note">Idée de Walid · déjà validée</p>`
                    : '';
          let red = (isAI && approval === 'pending') || (access && access.some((a) => !a.connected));
          return `<article class="card idea-card ${red ? 'cred' : ''}"><div class="idea-line"><div class="idea-copy"><div class="toolbar" style="margin:0 0 8px">${red ? colorDot('rouge') : colorDot('vert')}<span class="badge ${isAI ? 'blue' : 'gold'}">${isAI ? 'Proposée par l’IA' : idea.source === 'Walid' ? 'Ajoutée par Walid' : 'Idée'}</span>${isAI ? pill(approval === 'pending' ? 'À valider par Walid' : approval === 'approved' ? 'Validée par Walid' : 'Refusée') : ''}</div><strong>${esc(text)}</strong>${decision}<div class="toolbar" style="margin:10px 0"><span class="badge gold">Dernier stade atteint : ${esc(stage)}</span></div>${history.length ? `<p class="note">Parcours : ${history.map((x) => esc(x.stage)).join(' → ')}</p>` : ''}<section class="card space" style="margin-top:14px"><label>Commentaire de l’agent</label><p>${agentComment ? esc(agentComment) : '<span class="note">Aucun commentaire transmis pour le moment.</span>'}</p><label for="idea-reply-${t.id}-${i}">Ta réponse à l’agent</label><textarea id="idea-reply-${t.id}-${i}" placeholder="Écris ta réponse ou les informations qui lui manquent…">${esc(reply)}</textarea><div class="actions"><button class="small" id="idea-reply-btn-${t.id}-${i}" onclick="saveTaskIdeaReply('${t.id}',${i})">Enregistrer ma réponse</button></div><p class="reply-status" id="idea-reply-status-${t.id}-${i}">${replyStatus(t, idea)}</p></section></div><div class="idea-side">${connectionPanel(t, access)}<div class="idea-rank"><button class="small" aria-label="Augmenter la priorité de cette idée" ${i === 0 ? 'disabled' : ''} onclick="moveTaskIdea('${t.id}',${i},-1,${showTools})">↑ Priorité</button><button class="small" aria-label="Baisser la priorité de cette idée" ${i === t.ideas.length - 1 ? 'disabled' : ''} onclick="moveTaskIdea('${t.id}',${i},1,${showTools})">↓ Priorité</button></div></div></div>${
            showTools
              ? `<div class="tiny" style="margin:12px 0 5px">Outils envisagés pour cette idée</div><div class="toolbar" style="margin:0">${toolsForIdea(
                  t,
                  i,
                )
                  .map((x) => `<span class="badge">${esc(x)}</span>`)
                  .join('')}</div>`
              : ''
          }</article>`;
        })
        .join('') || '<div class="empty">Aucune idée proposée pour cette tâche.</div>'
  );
}
function setTaskIdeaApproval(id, index, approved, showTools) {
  let t = task(id);
  if (!t) return;
  let idea = t.ideas[index];
  if (typeof idea === 'string')
    idea = t.ideas[index] = {
      text: idea,
      latestStage: 'Planification',
      stageHistory: [],
      agentComment: '',
      walidReply: '',
    };
  idea.approvalStatus = approved ? 'approved' : 'rejected';
  save();
  refreshTaskIdeas(id, showTools);
  render();
  detail(id, showTools);
  notify(approved ? 'Idée validée ; l’IA peut la lancer au moment choisi.' : 'Idée refusée par Walid.');
}
function addTaskIdea(id, source, text) {
  let t = task(id);
  if (!t) return;
  t.ideas = t.ideas || [];
  t.ideas.unshift({
    id: id + '-idea-' + Date.now(),
    text,
    source,
    approvalStatus: source === 'IA' ? 'pending' : 'approved',
    latestStage: 'Planification',
    stageHistory: [],
    agentComment: source === 'IA' ? 'Proposition de démonstration à valider par Walid.' : '',
    walidReply: '',
  });
  save();
  closeDialog();
  detail(id, true);
  notify(
    source === 'IA'
      ? 'Idée ajoutée par l’IA : elle attend ta validation.'
      : 'Ton idée est ajoutée au plan et l’IA peut la lancer quand elle le décide.',
  );
}
function newTaskIdea(id, source = 'Walid') {
  let isAI = source === 'IA';
  modal(
    isAI ? 'Idée proposée par l’IA' : 'Ajouter une idée à l’action',
    `<form id="taskIdeaForm"><label>${isAI ? 'Idée proposée par l’IA' : 'Ton idée'}</label><textarea id="taskIdeaText" required placeholder="Décris l’idée à mettre en place…"></textarea><div class="actions"><button class="primary">${isAI ? 'Ajouter la proposition' : 'Ajouter mon idée'}</button></div></form>`,
  );
  document.getElementById('taskIdeaForm').onsubmit = (e) => {
    e.preventDefault();
    addTaskIdea(id, source, document.getElementById('taskIdeaText').value);
  };
}
function refreshTaskIdeas(id, showTools) {
  let t = task(id),
    el = document.getElementById('taskideas-' + id);
  if (el && t) el.innerHTML = taskIdeaCards(t, showTools);
}
function saveTaskIdeaReply(id, index) {
  let t = task(id),
    idea = t?.ideas?.[index],
    el = document.getElementById('idea-reply-' + id + '-' + index);
  if (!idea || !el) return;
  if (typeof idea === 'string')
    idea = t.ideas[index] = {
      id: id + '-idea-' + index,
      text: idea,
      latestStage: 'Planification',
      stageHistory: [],
      agentComment: '',
      walidReply: '',
    };
  idea.walidReply = el.value;
  idea.walidReplyAt = el.value.trim() ? new Date().toISOString() : undefined;
  save();
  let st = document.getElementById('idea-reply-status-' + id + '-' + index),
    btn = document.getElementById('idea-reply-btn-' + id + '-' + index);
  if (st) st.innerHTML = replyStatus(t, idea);
  if (btn) {
    btn.textContent = '✓ Enregistrée';
    btn.classList.add('saved');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.textContent = 'Enregistrer ma réponse';
      btn.classList.remove('saved');
    }, 2500);
  }
  notify(el.value.trim() ? 'Réponse enregistrée : l’agent la lira à son prochain tour.' : 'Réponse effacée.');
}
// Ligne d'état sous la réponse de Walid : enregistrée, puis lue par l'agent.
function replyStatus(t, idea) {
  if (!idea || typeof idea === 'string' || !(idea.walidReply || '').trim() || !idea.walidReplyAt) return '';
  let at = new Date(idea.walidReplyAt),
    when = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (t && t.lastAgentTurn && new Date(t.lastAgentTurn) > at)
    return `<span class="ok">✓✓ Lue par l’agent</span> · tour du ${when(new Date(t.lastAgentTurn))}`;
  return `<span class="ok">✓ Envoyée à l’agent</span> le ${when(at)} · il la lira à son prochain tour`;
}
function moveTaskIdea(id, index, direction, showTools) {
  let t = task(id),
    next = index + direction;
  if (!t || next < 0 || next >= t.ideas.length) return;
  [t.ideas[index], t.ideas[next]] = [t.ideas[next], t.ideas[index]];
  save();
  refreshTaskIdeas(id, showTools);
}
function connectionPanel(t, requests, compact = false) {
  if (!Array.isArray(requests) || !requests.length) return '';
  return `<aside class="task-access ${compact ? 'compact' : ''}"><h4>Accès requis</h4>${requests
    .map((r) => {
      let connected = !!data.toolConnections?.[r.id];
      return `<div class="task-access-item"><div class="toolbar" style="margin:0 0 7px"><strong>${esc(r.name)}</strong>${pill(connected ? 'Connecté' : 'À connecter')}</div><p>${esc(r.message || 'L’agent a besoin d’un accès à ' + r.name + ' pour poursuivre cette action.')}</p>${connected ? '' : `<p class="note">À connecter par Walid.</p>`}</div>`;
    })
    .join('')}<p class="note">L’agent indiquera ici quand l’accès sera branché.</p></aside>`;
}
function toggleConnection(taskId, connectionId) {
  data.toolConnections = data.toolConnections || {};
  data.toolConnections[connectionId] = !data.toolConnections[connectionId];
  save();
  closeDialog();
  render();
  detail(taskId, true);
  notify('État de connexion mis à jour dans la simulation.');
}
function ideaAccessRows(t) {
  return (t.ideas || [])
    .map((i) => {
      if (typeof i === 'string' || !i.accessRequests?.length) return '';
      return `<div class="execution-subtask"><div><span class="tiny">IDÉE À EXÉCUTER</span><strong>${esc(i.text)}</strong></div>${connectionPanel(t, i.accessRequests, true)}</div>`;
    })
    .join('');
}
function executionCard(t) {
  const ideas = (t.ideas || []).length;
  const last = (t.reviewHistory || []).find((h) => h.by === 'agent' || h.aiObservation) || {};
  const extra =
    t.format === 'Vidéo longue' ? btn('Décliner en formats courts', `recycleContent('${t.id}')`) : '';
  return `<article class="card acard">${cardHead(t, 'execution')}<h3>${esc(t.title)}</h3><p class="adesc">${
    ideas ? `${ideas} idée${ideas > 1 ? 's' : ''} en cours. ` : ''
  }${last.aiObservation ? esc(last.aiObservation) : esc(t.goal || '')}</p>${ideaAccessRows(t)}<div class="actions">${btn(
    'Ouvrir',
    `detail('${t.id}',true)`,
  )}${btn('Mettre en pause', `toggleTaskPause('${t.id}')`)}${extra}</div></article>`;
}
function toggleTaskPause(id) {
  let t = task(id);
  if (!t) return;
  const resume = isPaused(t);
  t.paused = !resume;
  if (resume && t.status === 'En pause') t.status = 'En cours';
  if (!resume) t.pausedAt = new Date().toISOString();
  save();
  render();
  notify(resume ? 'Action reprise.' : 'Action mise en pause : rien ne tourne en attendant.');
}
function execution() {
  const live = data.tasks.filter(isLive);
  const late = live.filter(turnLate);
  const stopped = data.tasks
    .filter((t) => t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected' && (t.done || isPaused(t)))
    .sort((a, b) => String(b.doneAt || b.pausedAt || '').localeCompare(String(a.doneAt || a.pausedAt || '')));
  const oldest = late.reduce((a, t) => Math.max(a, daysSince(t.lastAgentTurn || t.decidedAt || t.proposedAt) || 0), 0);
  const banner = late.length
    ? `<section class="strip banner down"><div><strong>${
        late.length === live.length ? `Aucun tour depuis ${oldest} jours` : `${countWord(late.length, 'action n’a', 'actions n’ont')} pas tourné à temps`
      }</strong><p>${late
        .map((t) => `${esc(t.title)} : ${t.lastAgentTurn ? 'dernier tour ' + agoText(t.lastAgentTurn) : 'jamais tourné'}`)
        .join(' · ')}</p></div></section>`
    : '';
  const quiet = stopped.length
    ? `<h2 class="section-title" style="color:var(--text-3)">Ce qui ne tourne plus <span class="note">${stopped.length} action${
        stopped.length > 1 ? 's' : ''
      }</span></h2><p class="note" style="margin:-6px 0 14px">Elles restent lisibles ici, mais ne comptent plus dans ce qui travaille. Leurs résultats et leurs leçons sont conservés.</p><div class="quiet-list">${stopped
        .map(
          (t) =>
            `<div><span><span class="qt">${esc(t.title)}</span><span class="note"> — ${
              t.done ? 'terminée' + (t.doneAt ? ' le ' + shortDay(t.doneAt) : '') : 'en pause' + (t.pausedAt ? ' depuis le ' + shortDay(t.pausedAt) : '')
            }</span></span>${t.done ? `<a href="#memoire">Ce qu’on en a appris</a>` : btn('Reprendre', `toggleTaskPause('${t.id}')`)}</div>`,
        )
        .join('')}</div>`
    : '';
  return (
    head('Exécution', 'Ce qui tourne en ce moment, et quand chaque action a travaillé pour la dernière fois.') +
    `${banner}<h2 class="section-title">Ce qui tourne <span class="note">${live.length} action${live.length > 1 ? 's' : ''}</span></h2><div class="cards" style="margin-bottom:36px">${
      live.map(executionCard).join('') || '<div class="empty">Rien ne tourne en ce moment.</div>'
    }</div>${quiet}`
  );
}
function mediaPreview(t) {
  return `<div class="video-preview ${t.media === 'short' ? 'short' : ''}"><div><div class="play">▶</div><strong>${esc(t.hook || t.title)}</strong><p class="tiny">Aperçu ${t.format === 'Vidéo longue' ? '16:9' : '9:16'} · simulation</p></div></div>`;
}
function detail(id, showTools = false) {
  let t = task(id);
  if (!t) return;
  let ideaList = taskIdeaCards(t, showTools),
    youtube = t.format
      ? `<section class="card space"><h3>Aperçu avant publication</h3>${mediaPreview(t)}<div class="grid"><div><h3>Hook</h3><p>${esc(t.hook || 'Hook à préparer')}</p><h3>Script</h3><p style="white-space:pre-line">${esc(t.script || 'Script à préparer par l’agent.')}</p></div><div><h3>Miniature</h3><div class="video-preview"><div><div class="play">▧</div><strong>${esc(t.visual || 'Proposition de miniature')}</strong></div></div><h3>Voix et fichier média</h3><p>${esc(t.voice || 'Voix à définir')}</p><audio controls style="width:100%"></audio><p class="note">Lecteur factice : aucun fichier audio/vidéo réel n’est attaché.</p></div></div><label>État de la file</label><select id="q-${t.id}" onchange="setQueue('${t.id}',this.value)">${queueStates.map((s) => `<option ${(data.queue[t.id] || t.status) === s ? 'selected' : ''}>${s}</option>`).join('')}</select><div class="actions">${btn('Valider et programmer sur YouTube', `approveVideo('${t.id}')`, 'good')}${btn('🔄 Demander une réécriture/modification à l’agent', `rewriteVideo('${t.id}')`)}${btn('Rejeter', `rejectVideo('${t.id}')`, 'danger')}</div><p class="note">La validation modifie uniquement l’état local ; elle ne programme aucune vraie vidéo.</p></section>`
      : '';
  modal(
    t.title,
    `<div class="toolbar">${pill(t.status)}<span class="badge gold">${esc(t.category)}</span><span class="badge">${esc(t.format || t.type)}</span></div><div class="task-detail-layout"><div class="task-main"><p>${esc(t.goal)}</p><div class="meta"><div><span>Responsable</span>${esc(t.owner)}</div><div><span>Révision prévue</span>${esc(t.reviewCadence || (t.type === 'Ponctuelle' || t.format ? 'Chaque jour' : 'Chaque lundi'))}</div><div><span>Critère de réussite</span>${esc(t.metric)}</div><div><span>Plan d’exécution</span>${esc(executionPlan(t.owner))}</div></div></div></div>${youtube}<div class="heading" style="margin:20px 0 8px"><h3>Idées de cette action</h3><div class="actions" style="margin:0">${btn('+ Ajouter mon idée', "newTaskIdea('TID','Walid')".replace('TID', id))}</div></div><p class="note">Les idées de Walid sont approuvées directement. Toute idée ajoutée par l’IA doit être validée ou refusée avec les boutons vert et rouge. Une idée validée peut partir en exécution quand l’IA le décide. Ces idées sont indépendantes. L’agent peut en retenir certaines, en écarter d’autres et les classer par priorité ; aucune idée ne dépend de la validation d’une précédente. Chaque carte affiche le stade le plus récemment atteint. Si une idée repart en boucle de Révision vers Exécution, son stade affiché redevient Exécution ; son parcours précédent reste visible.</p><div id="taskideas-${id}">${ideaList}</div><label>État de l’action</label><select id="taskstatus">${['À planifier', ...queueStates, 'À valider', 'Terminée', 'Bloquée'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><label>Ta description ou tes remarques pour l’agent</label><textarea id="taskfeedback" placeholder="Explique ce que tu penses de l’action…">${esc(t.feedback || '')}</textarea><div class="actions">${btn('Enregistrer mon avis', `saveFeedback('${id}')`, 'primary')}${btn('Enregistrer le statut', `updateTask('${id}')`)}${btn('Voir l’exécution', 'closeDialog();go(1)')}</div><p class="note">Ton avis reste dans ce navigateur ; il n’est pas transmis à un agent réel.</p>`,
  );
}
function setQueue(id, s) {
  data.queue[id] = s;
  save();
  notify('État de production enregistré.');
}
function approveVideo(id) {
  data.queue[id] = 'Programmé';
  task(id).status = 'Programmé';
  save();
  closeDialog();
  render();
  notify('Contenu validé : marqué comme programmé.');
}
function rewriteVideo(id) {
  let t = task(id);
  t.status = 'En cours de génération script';
  data.queue[id] = t.status;
  t.feedback = (t.feedback ? t.feedback + '\n' : '') + 'Walid demande une réécriture ou une modification.';
  save();
  closeDialog();
  render();
  notify('Demande de réécriture enregistrée dans la simulation.');
}
function rejectVideo(id) {
  let t = task(id);
  t.status = 'Rejeté';
  data.queue[id] = 'Rejeté';
  save();
  closeDialog();
  render();
  notify('Contenu rejeté dans la simulation.');
}
function newTask() {
  modal(
    'Ajouter une action au projet',
    `<form id="newform"><label>Action à réaliser</label><input id="newtitle" required placeholder="Ex. tester un hook de trois secondes"><label>Objectif</label><textarea id="newgoal" required placeholder="Quel résultat veux-tu obtenir ?"></textarea><div class="grid"><div><label>Sujet de l’action</label><select id="newcategory">${categories.map((c) => `<option>${c}</option>`).join('')}</select></div><div><label>Format</label><select id="newformat"><option value="">Sans format vidéo</option>${formats.map((f) => `<option>${f}</option>`).join('')}</select></div></div><div class="grid"><div><label>Responsable</label><select id="newowner"><option>Walid</option><option>Agent</option></select><p class="note">Claude choisira le spécialiste et les outils si Agent est responsable.</p></div><div><label>Type</label><select id="newtype"><option>Ponctuelle</option><option>Boucle</option></select></div></div><label>Révision de l’action</label><select id="newReviewCadence"><option value="Chaque jour">Journalière</option><option value="Chaque lundi">Hebdomadaire · chaque lundi</option></select><p class="note">Choisis quand l’IA doit faire le point sur cette action.</p><label>Critère de réussite</label><input id="newmetric" placeholder="Comment mesurer la réussite ?"><div class="actions"><button class="primary">Ajouter au plan</button></div></form>`,
  );
  document.getElementById('newform').onsubmit = (e) => {
    e.preventDefault();
    let owner = document.getElementById('newowner').value,
      id = 'action-' + Date.now();
    data.tasks.push({
      id,
      title: document.getElementById('newtitle').value,
      goal: document.getElementById('newgoal').value,
      category: document.getElementById('newcategory').value,
      format: document.getElementById('newformat').value || undefined,
      origin: 'Walid',
      owner,
      executionPlan: executionPlan(owner),
      type: document.getElementById('newtype').value,
      metric: document.getElementById('newmetric').value || 'À préciser',
      status: owner === 'Agent' ? 'À transmettre à Claude' : 'À planifier',
      paused: false,
      freq: 'Chaque lundi',
      reviewCadence: document.getElementById('newReviewCadence').value,
      reviewState: 'À examiner par l’agent',
      ideas: [
        {
          text: 'Analyser le sujet et la description',
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        },
        {
          text: 'Proposer des pistes de réalisation et les outils adaptés',
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        },
        {
          text: 'Choisir et classer les pistes à essayer',
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        },
      ],
    });
    data.priorities.push(id);
    save();
    closeDialog();
    render();
    notify('Action ajoutée sans modifier les actions existantes.');
  };
}
function updateTask(id) {
  let t = task(id);
  t.status = document.getElementById('taskstatus').value;
  if (t.format) data.queue[id] = t.status;
  t.feedback = document.getElementById('taskfeedback').value;
  save();
  closeDialog();
  render();
  notify('Action et remarque enregistrées localement.');
}
function saveFeedback(id) {
  task(id).feedback = document.getElementById('taskfeedback').value;
  save();
  closeDialog();
  notify('Ton avis est enregistré avec cette action.');
}
function verificationCard(t) {
  if (t.format) {
    let explanation =
      t.performance === 'Top performance'
        ? 'La rétention dépasse la cible : conserver le hook et confirmer sur plus de vues.'
        : t.performance === 'Flop'
          ? 'CTR ou rétention sous la cible : tester une miniature ou un hook différent.'
          : 'Indicateurs proches des résultats attendus : poursuivre le test avant de conclure.';
    return `<article class="card performance ${t.performance === 'Top performance' ? 'top' : t.performance === 'Flop' ? 'flop' : ''}"><div class="toolbar" style="margin:0 0 9px">${pill(t.performance || 'Dans la moyenne')}<span class="badge">${esc(t.format)}</span></div><h2>${esc(t.title)}</h2><div class="metricgrid"><div class="metricbox"><span class="tiny">CTR miniature</span><strong>${esc(t.ctr || '—')}%</strong></div><div class="metricbox"><span class="tiny">Rétention à 30 s / non-swipe</span><strong>${esc(t.retention || '—')}%</strong></div><div class="metricbox"><span class="tiny">Durée moyenne · AVD</span><strong>${esc(t.avd || '—')}</strong></div></div><p style="margin-top:13px">${explanation}</p><div class="grid"><div><label>CTR cible (%)</label><input type="number" value="${esc(t.targetCtr || '')}" placeholder="Ex. 7" oninput="updateYTMetric('${t.id}','targetCtr',this.value)"></div><div><label>CTR mesuré (%)</label><input type="number" value="${esc(t.ctr || '')}" oninput="updateYTMetric('${t.id}','ctr',this.value)"></div><div><label>Rétention cible (%)</label><input type="number" value="${esc(t.targetValue || '')}" oninput="updateYTMetric('${t.id}','targetValue',this.value)"></div><div><label>Rétention mesurée (%)</label><input type="number" value="${esc(t.retention || '')}" oninput="updateYTMetric('${t.id}','retention',this.value)"></div></div><div class="actions">${btn('Recalculer la performance', `recalcPerformance('${t.id}')`)}</div></article>`;
  }
  return `<article class="card"><h2>${esc(t.title)}</h2><p>${esc(t.metric || 'À définir')}</p><div class="grid"><div><label>Objectif chiffré</label><input id="target-${t.id}" type="number" value="${esc(t.targetValue || '')}" oninput="updateOldMetric('${t.id}','targetValue',this.value)"></div><div><label>Résultat mesuré</label><input id="actual-${t.id}" type="number" value="${esc(t.actualValue || '')}" oninput="updateOldMetric('${t.id}','actualValue',this.value)"></div></div><label>Sens de l’objectif</label><select id="direction-${t.id}" onchange="updateOldMetric('${t.id}','direction',this.value)"><option value="increase" ${t.direction !== 'reduce' ? 'selected' : ''}>Augmenter</option><option value="reduce" ${t.direction === 'reduce' ? 'selected' : ''}>Réduire</option></select><div id="gap-${t.id}" class="strip" style="margin-top:13px"><strong>Écart à l’objectif</strong><p>${verificationGap(t)}</p></div></article>`;
}
function verificationGap(t) {
  if (t.targetValue == null || t.targetValue === '' || t.actualValue == null || t.actualValue === '')
    return 'Renseigne la cible et le résultat mesuré pour calculer l’écart.';
  let delta =
    t.direction === 'reduce'
      ? Number(t.targetValue) - Number(t.actualValue)
      : Number(t.actualValue) - Number(t.targetValue);
  return delta >= 0
    ? 'Objectif atteint ou dépassé de ' + delta + '.'
    : 'Il manque ' + Math.abs(delta) + ' pour atteindre l’objectif.';
}
function updateYTMetric(id, k, v) {
  task(id)[k] = v;
  save();
}
function updateOldMetric(id, k, v) {
  let t = task(id);
  t[k] = v;
  save();
  let el = document.getElementById('gap-' + id);
  if (el) el.innerHTML = '<strong>Écart à l’objectif</strong><p>' + verificationGap(t) + '</p>';
}
function recalcPerformance(id) {
  let t = task(id),
    ctr = Number(t.ctr || 0),
    ret = Number(t.retention || 0),
    ct = Number(t.targetCtr || 7),
    rt = Number(t.targetValue || 70);
  t.performance =
    ctr >= ct && ret >= rt ? 'Top performance' : ctr < ct * 0.65 || ret < rt * 0.75 ? 'Flop' : 'Dans la moyenne';
  save();
  render();
  notify('Performance recalculée depuis les cibles CTR et rétention.');
}
function followerRow(n) {
  let gap = Number(n.target) - Number(n.current),
    pct = n.target ? Math.max(0, Math.min(100, (Number(n.current) / Number(n.target)) * 100)) : 0,
    conversion = n.monthlyViews ? (Number(n.followersGained) / Number(n.monthlyViews)) * 100 : 0,
    viewsPerFollower = n.followersGained ? Number(n.monthlyViews) / Number(n.followersGained) : 0;
  return `<tr><td><strong>${esc(n.platform)}</strong></td><td>${Number(n.target).toLocaleString('fr-FR')}</td><td><input aria-label="Abonnés actuels ${esc(n.platform)}" type="number" min="0" value="${esc(n.current)}" oninput="updateFollowers('${n.id}',this.value)"></td><td id="gap-follow-${n.id}">${gap > 0 ? gap.toLocaleString('fr-FR') + ' à franchir' : gap === 0 ? 'Objectif atteint' : 'Objectif dépassé de ' + Math.abs(gap).toLocaleString('fr-FR')}</td><td><span id="conv-${n.id}">${conversion.toFixed(2).replace('.', ',')}%</span><br><span class="note" id="vpf-${n.id}">${viewsPerFollower.toFixed(1).replace('.', ',')} vues / abonné</span></td><td><div class="progress"><i id="progress-${n.id}" style="width:${pct}%"></i></div><span class="note" id="pct-${n.id}">${pct.toFixed(1).replace('.', ',')}%</span></td></tr>`;
}
function updateFollowers(id, value) {
  let n = data.followers.find((x) => x.id === id);
  if (!n) return;
  n.current = Number(value || 0);
  save();
  let gap = Number(n.target) - n.current,
    pct = n.target ? Math.max(0, Math.min(100, (n.current / n.target) * 100)) : 0,
    conversion = n.monthlyViews ? (Number(n.followersGained) / Number(n.monthlyViews)) * 100 : 0,
    vpf = n.followersGained ? Number(n.monthlyViews) / Number(n.followersGained) : 0;
  document.getElementById('gap-follow-' + id).textContent =
    gap > 0
      ? gap.toLocaleString('fr-FR') + ' à franchir'
      : gap === 0
        ? 'Objectif atteint'
        : 'Objectif dépassé de ' + Math.abs(gap).toLocaleString('fr-FR');
  document.getElementById('progress-' + id).style.width = pct + '%';
  document.getElementById('pct-' + id).textContent = pct.toFixed(1).replace('.', ',') + '%';
  document.getElementById('conv-' + id).textContent = conversion.toFixed(2).replace('.', ',') + '%';
  document.getElementById('vpf-' + id).textContent = vpf.toFixed(1).replace('.', ',') + ' vues / abonné';
}
function verification() {
  let followersBoard =
    projectId === 'vegebudget'
      ? `<section class="card space"><h2>Acquisition multi-plateformes · tâche VégéBudget</h2><p class="note">Écart = objectif cible − abonnés actuels. La progression se recalcule dès que tu modifies le nombre actuel.</p><div class="tablewrap"><table><thead><tr><th>Plateforme</th><th>Objectif cible</th><th>Abonnés actuels</th><th>Écart à franchir</th><th>Conversion / vues par abonné</th><th>Objectif atteint</th></tr></thead><tbody>${data.followers.map(followerRow).join('')}</tbody></table></div></section>`
      : '';
  return (
    head('Vérification', 'Comparer les résultats aux objectifs de ' + projectDef.name + '.') +
    followersBoard +
    `${projectDef.kind === 'youtube' ? `<div class="strip"><p class="note">CTR, rétention à 30 secondes et durée moyenne de visionnage (AVD) sont affichés pour les contenus vidéo.</p></div>` : ''}<h2>Résultats par tâche</h2><div class="grid">${data.tasks
      .filter((t) => t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected')
      .map(verificationCard)
      .join('')}</div>`
  );
}
function recycleContent(sourceId) {
  let source = task(sourceId),
    title = source?.title || 'Vidéo YouTube';
  modal(
    'Décliner un contenu sur plusieurs réseaux',
    `<form id="recycleform"><label>Vidéo source</label><input id="recyclesource" value="${esc(title)}" required><p class="note">La tâche est créée pour Instagram Reels, TikTok et YouTube Shorts. L’objectif de la tâche précise les adaptations attendues.</p><div class="actions"><button class="primary">Créer la tâche de recyclage</button></div></form>`,
  );
  document.getElementById('recycleform').onsubmit = (e) => {
    e.preventDefault();
    let sourceTitle = document.getElementById('recyclesource').value,
      id = 'recycle-' + Date.now();
    data.tasks.push({
      id,
      title: 'Recycler une vidéo YouTube en Reels Instagram, TikTok et Shorts',
      origin: 'Walid',
      owner: 'Agent',
      goal: 'Adapter « ' + sourceTitle + ' » pour Instagram Reels, TikTok et YouTube Shorts.',
      metric: '3 déclinaisons prêtes et validées',
      status: 'À planifier',
      type: 'Boucle',
      paused: false,
      freq: 'À chaque vidéo source',
      category: 'Réseaux sociaux',
      sourceTitle,
      ideas: [
        {
          text: 'Sélectionner plusieurs extraits pertinents',
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        },
        {
          text: 'Adapter les hooks, sous-titres et cadrages aux formats courts',
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        },
        {
          text: 'Présenter les trois déclinaisons à Walid pour validation',
          latestStage: 'Planification',
          stageHistory: [],
          agentComment: '',
          walidReply: '',
        },
      ],
    });
    data.priorities.push(id);
    save();
    closeDialog();
    render();
    notify('Tâche de recyclage ajoutée à la planification.');
  };
}
// Mémoire rangée par projet (CADRAGE §10) : chaque leçon dit l'action qui l'a produite.
function memory() {
  const mems = data.memories || [];
  const count = (st) => mems.filter((m) => lessonState(m) === st).length;
  const f = [
    ['Toutes', 'Toutes', ''],
    ['confirmée', `Confirmées · ${count('confirmée')}`, 'c-up'],
    ['à tester', `À tester · ${count('à tester')}`, ''],
    ['invalidée', `Invalidées · ${count('invalidée')}`, 'c-down'],
  ];
  const learning = new Set(mems.map((m) => m.taskId));
  const silent = data.tasks.filter(
    (t) => t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected' && !t.done && !learning.has(t.id),
  );
  const since = (t) => {
    const d = daysSince(t.decidedAt || t.proposedAt);
    if (!t.lastAgentTurn) return 'aucun tour enregistré';
    if (d === null) return 'dernier tour ' + agoText(t.lastAgentTurn);
    return d < 7 ? `tourne depuis ${d || 1} jour${d > 1 ? 's' : ''}` : `tourne depuis ${Math.floor(d / 7)} semaine${d >= 14 ? 's' : ''}`;
  };
  return (
    head(
      'Mémoire',
      'Ce que ce projet a appris. Une leçon se teste, puis se confirme ou s’invalide — c’est ce qui fait la différence entre une intuition et une règle.',
      btn('Règles du projet', 'editGoldenRules()'),
    ) +
    `<div class="toolbar" style="margin:0 0 14px">${f
      .map(([k, label, c]) => btn(label, `setMemoryFilter('${k}')`, (memoryFilter === k ? 'active ' : '') + c))
      .join('')}</div><input placeholder="Rechercher une leçon ou une action…" value="${esc(window.query || '')}" oninput="searchMemory(this.value)" style="max-width:520px"><div class="cards" id="memoryCards" style="margin:18px 0 36px">${memoryCards()}</div>${
      silent.length
        ? `<h2 class="section-title">Les actions qui n’ont encore rien appris</h2><p class="note" style="margin:-6px 0 14px">Elles tournent, mais aucune leçon n’en est sortie. C’est normal au début, inquiétant après plusieurs semaines.</p><div class="quiet-list">${silent
            .map((t) => `<div><span style="color:var(--text-2)">${esc(t.title)}</span><span class="note">${since(t)}</span></div>`)
            .join('')}</div>`
        : ''
    }`
  );
}
function setMemoryFilter(f) {
  memoryFilter = f;
  render();
}
function setLessonStateAt(i, st) {
  const m = (data.memories || [])[i];
  if (!m) return;
  m.state = st;
  save();
  render();
  notify('Leçon marquée « ' + st + ' ».');
}
function memoryMatches(m, q) {
  return [m.title, m.text, m.lesson, m.kind, m.tag, m.cycle, m.date].join(' ').toLowerCase().includes(q.toLowerCase());
}
function isMemorySuccess(m) {
  return ['Réussites', 'Hooks efficaces'].includes(m.kind);
}
function isMemoryFailure(m) {
  return ['Échecs', 'Hooks rejetés'].includes(m.kind);
}
function memoryRecordMarkup(m, ti, idx) {
  let st = lessonState(m);
  let cls = st === 'confirmée' ? 'ok' : st === 'invalidée' ? 'ko' : '';
  let ctrls =
    ti !== undefined
      ? `<div style="margin-top:8px">${LESSON_STATES.map((s) => `<span class="lessonstate ${s === st ? (s === 'confirmée' ? 'ok' : s === 'invalidée' ? 'ko' : '') : ''}" onclick="setLessonState('${ti}',${idx},'${s}')" style="${s === st ? 'font-weight:600' : 'opacity:.55'}">${s}</span>`).join('')}</div>`
      : '';
  return `<article class="memory-record"><div class="memory-date">${m.date ? formatReviewDate(m.date) : esc(m.cycle || 'Date à préciser')} · ${esc(m.tag || m.kind)} <span class="lessonstate ${cls}">${esc(st)}</span></div><strong>${esc(m.title)}</strong><p class="muted">${esc(m.text)}</p><p class="note">Leçon à réutiliser : ${esc(m.lesson || 'À compléter')}</p>${ctrls}</article>`;
}
function memoryCards() {
  const q = (window.query || '').toLowerCase();
  const mems = (data.memories || []).map((m, i) => ({ m, i }));
  const list = mems
    .filter(({ m }) => memoryFilter === 'Toutes' || lessonState(m) === memoryFilter)
    .filter(({ m }) => {
      if (!q) return true;
      const t = task(m.taskId);
      return memoryMatches(m, q) || (t && t.title.toLowerCase().includes(q));
    })
    .sort((a, b) => String(b.m.date || '').localeCompare(String(a.m.date || '')));
  const tone = { confirmée: 'up', invalidée: 'down', 'à tester': 'idle' };
  const label = { confirmée: 'Confirmée', invalidée: 'Invalidée — ça ne venait pas de là', 'à tester': 'À tester' };
  return (
    list
      .map(({ m, i }) => {
        const st = lessonState(m);
        const t = task(m.taskId);
        const moves = LESSON_STATES.filter((x) => x !== st)
          .map((x) => btn(x === 'confirmée' ? 'Confirmer' : x === 'invalidée' ? 'Invalider' : 'Remettre à tester', `setLessonStateAt(${i},'${x}')`, 'small'))
          .join('');
        return `<article class="card acard${st === 'invalidée' ? ' cgrey' : ''}"><div class="ahead"><span class="astate c-${tone[st]}">${label[st]}</span><span class="note">${
          m.date ? shortDay(m.date) + ' · ' : ''
        }${esc(t ? t.title : m.tag || m.kind || '')}</span></div><h3>${esc(m.title || 'Leçon')}</h3><p class="adesc" style="-webkit-line-clamp:5">${esc(m.text || '')}</p>${
          m.lesson ? `<p class="note" style="margin:10px 0 0">Ce qu’on en retient : ${esc(m.lesson)}</p>` : ''
        }<div class="actions">${moves}</div></article>`;
      })
      .join('') || '<div class="empty">Aucune leçon ici pour l’instant.</div>'
  );
}
function openActionMemory(id) {
  let t = task(id);
  if (!t) return;
  let items = (data.memories || []).filter((m) => m.taskId === id),
    successes = items.filter(isMemorySuccess),
    failures = items.filter(isMemoryFailure),
    other = items.filter((m) => !isMemorySuccess(m) && !isMemoryFailure);
  modal(
    'Mémoire de l’action · ' + t.title,
    `<p class="note">${esc(projectDef.name)} · ${esc(t.goal || 'Enseignements associés à cette action.')}</p><p class="note">L’agent peut réutiliser ces expériences pour choisir ou ajuster ses prochaines actions.</p><div class="memory-project-grid"><section class="memory-outcome success"><h3>Réussites</h3>${successes.map((m) => memoryRecordMarkup(m, id, items.indexOf(m))).join('') || '<p class="note">Aucune réussite consignée pour cette action.</p>'}</section><section class="memory-outcome failure"><h3>Échecs</h3>${failures.map((m) => memoryRecordMarkup(m, id, items.indexOf(m))).join('') || '<p class="note">Aucun échec consigné pour cette action.</p>'}</section></div>${other.length ? `<details class="memory-section"><summary style="cursor:pointer;color:var(--gold)">Autres enseignements (${other.length})</summary>${other.map((m) => memoryRecordMarkup(m, id, items.indexOf(m))).join('')}</details>` : ''}`,
  );
}
function editGoldenRules() {
  modal(
    'Règles du projet · ' + projectDef.name,
    `<p class="note">Une règle par ligne. Elles restent enregistrées dans la mémoire de ce projet.</p><textarea id="ruleText" style="min-height:180px">${esc(data.rules.join('\n'))}</textarea><div class="actions">${btn('Enregistrer les règles', "data.rules=document.getElementById('ruleText').value.split('\\n').map(x=>x.trim()).filter(Boolean);save();closeDialog();render();notify('Règles mises à jour.')", 'primary')}</div>`,
  );
}
function searchMemory(q) {
  window.query = q;
  document.getElementById('memoryCards').innerHTML = memoryCards();
}
function priorities() {
  const order = (data.priorities || [])
    .map((id) => ({ t: task(id) }))
    .filter(({ t }) => t && t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected' && !t.done);
  const line = (t) => {
    const st = stateLine(t, 'execution');
    const w = waitReasons(t);
    if (w.length) return `<div class="c-wait">${esc(w[0].text)}</div>`;
    const prog = t.objective && typeof objectiveProgress === 'function' ? objectiveProgress(t) : '';
    return `<div class="c-${st.tone === 'up' ? 'idle' : st.tone}">${esc(
      [t.type === 'Boucle' ? 'Boucle ' + (cadenceDays(t) === 1 ? 'quotidienne' : 'hebdomadaire') : 'Ponctuelle', st.text.toLowerCase(), prog].filter(Boolean).join(' · '),
    )}</div>`;
  };
  return (
    head('Priorités', 'L’ordre dans lequel l’agent traite les actions. Ce qui est en haut passe en premier quand le temps manque.') +
    `<ol class="prio">${
      order
        .map(
          ({ t }, n) =>
            `<li><span class="rank">${n + 1}</span><div class="grow"><div class="pt">${esc(t.title)}</div>${line(t)}</div><div class="pm"><button class="small" aria-label="Monter ${esc(
              t.title,
            )}" ${n === 0 ? 'disabled' : ''} onclick="moveVisiblePriority('${t.id}',-1)">↑</button><button class="small" aria-label="Descendre ${esc(t.title)}" ${
              n === order.length - 1 ? 'disabled' : ''
            } onclick="moveVisiblePriority('${t.id}',1)">↓</button></div></li>`,
        )
        .join('') || '<li class="empty">Aucune action à classer.</li>'
    }</ol>` +
    `${projectId === 'vegebudget' || projectDef.kind === 'youtube' ? `<section class="card space"><h2>Quota de production quotidien</h2><div class="grid"><div><label>Nombre de Shorts par jour</label><input type="number" min="0" max="20" value="${esc(data.quota)}" oninput="data.quota=this.value;save();document.getElementById('quotaLabel').textContent=this.value+' Short(s) par jour'"></div><div><label>Cadence sélectionnée</label><div class="metric" id="quotaLabel">${esc(data.quota)} Short(s) par jour</div><p class="note">Modifiable selon les ressources et les résultats.</p></div></div></section>` : ''}${(data.themes || []).length ? `<section class="card space"><h2>Arbitrage des thématiques</h2><p class="note">Réorganise les sujets selon CTR, rétention et abonnements observés dans Vérification.</p>${data.themes.map((th, i) => `<div class="row"><span class="rank">0${i + 1}</span><div class="grow"><strong>${esc(th)}</strong><p class="note">Signal : ${esc(data.themeSignals?.[th] || (i === 0 ? 'résultat à confirmer' : i === 1 ? 'test à poursuivre' : 'données à compléter'))}</p></div><button class="small" ${i === 0 ? 'disabled' : ''} onclick="moveTheme(${i},-1)">↑</button><button class="small" ${i === data.themes.length - 1 ? 'disabled' : ''} onclick="moveTheme(${i},1)">↓</button></div>`).join('')}</section>` : ''}`
  );
}
// Échange avec la voisine visible (les actions masquées gardent leur place).
function moveVisiblePriority(id, d) {
  const visible = (data.priorities || []).filter((x) => {
    const t = task(x);
    return t && t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected' && !t.done;
  });
  const k = visible.indexOf(id);
  const other = visible[k + d];
  if (k < 0 || !other) return;
  const a = data.priorities.indexOf(id),
    b = data.priorities.indexOf(other);
  [data.priorities[a], data.priorities[b]] = [data.priorities[b], data.priorities[a]];
  save();
  render();
}
function moveTheme(i, d) {
  [data.themes[i], data.themes[i + d]] = [data.themes[i + d], data.themes[i]];
  save();
  render();
}
function movePriority(i, d) {
  [data.priorities[i], data.priorities[i + d]] = [data.priorities[i + d], data.priorities[i]];
  save();
  render();
}
function reviewCadenceFor(t) {
  return t.reviewCadence || (t.type === 'Ponctuelle' || t.format ? 'Chaque jour' : 'Chaque lundi');
}
function reviewResultSummary(t) {
  if (t.reviewResult) return `<p style="white-space:pre-line">${esc(t.reviewResult)}</p>`;
  if (t.id === 'growth-multiplatform') {
    let f = data.followers || [],
      target = f.reduce((a, x) => a + Number(x.target || 0), 0),
      current = f.reduce((a, x) => a + Number(x.current || 0), 0);
    return `<strong>${current.toLocaleString('fr-FR')} / ${target.toLocaleString('fr-FR')} abonnés</strong><p>Écart restant : ${Math.max(0, target - current).toLocaleString('fr-FR')}</p>`;
  }
  if (t.id.startsWith('growth-')) {
    let key = t.id.replace('growth-', ''),
      n = (data.followers || []).find((x) => x.id === key);
    if (n) {
      let gap = Math.max(0, Number(n.target) - Number(n.current)),
        pct = n.target ? Math.min(100, (Number(n.current) / Number(n.target)) * 100) : 0;
      return `<strong>${Number(n.current).toLocaleString('fr-FR')} / ${Number(n.target).toLocaleString('fr-FR')} abonnés</strong><p>Écart restant : ${gap.toLocaleString('fr-FR')} · ${pct.toFixed(1).replace('.', ',')} % de l’objectif</p>`;
    }
  }
  if (t.format) {
    return `<div class="metricgrid"><div class="metricbox"><span class="tiny">CTR miniature</span><strong>${esc(t.ctr || '—')}%</strong></div><div class="metricbox"><span class="tiny">Rétention 30 s</span><strong>${esc(t.retention || '—')}%</strong></div><div class="metricbox"><span class="tiny">Durée moyenne</span><strong>${esc(t.avd || '—')}</strong></div></div>`;
  }
  if (t.actualValue !== undefined && t.actualValue !== '') {
    return `<strong>${esc(t.actualValue)}</strong><p>${esc(verificationGap(t))}</p>`;
  }
  return `<p class="muted">Aucun résultat mesuré pour le moment.</p><p class="note">Indicateur attendu : ${esc(t.metric || t.goal)}</p>`;
}
function formatReviewDate(value) {
  let parts = String(value || '').split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0].slice(-2) : esc(value || 'Date inconnue');
}
function reviewHistoryMarkup(t) {
  let history = [...(t.reviewHistory || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return (
    history
      .map(
        (entry) =>
          `<article class="card review-entry"><div class="toolbar" style="margin:0 0 8px"><span class="badge gold">${entry.cycle ? esc(entry.cycle) + ' · ' : ''}${formatReviewDate(entry.date)}</span><span class="badge blue">Rédigé par l’IA</span></div><span class="tiny">CONSTAT DE L’IA</span><p>${esc(entry.aiObservation || 'Aucun constat renseigné.')}</p><span class="tiny">DÉCISION DE L’IA</span><p>${esc(entry.aiDecision || 'Poursuivre les idées déjà validées.')}${entry.plan ? ' · ' + esc(entry.plan) : ''}</p></article>`,
      )
      .join('') ||
    '<p class="note">Aucune revue enregistrée pour le moment. L’historique se remplira lorsque l’IA réalisera sa première revue.</p>'
  );
}
function reviewTagClass(type) {
  return type === 'Erreur de fait / à refaire' ? 'fact' : type === 'Changement de stratégie' ? 'strategy' : '';
}
function reviewConversationPanel(t, id) {
  let messages =
    (t.reviewConversation || [])
      .map(
        (m) =>
          `<article class="review-entry"><div class="toolbar"><span class="badge ${m.role === 'Walid' ? 'gold' : 'blue'}">${esc(m.role === 'Walid' ? 'Walid' : 'IA')}</span><span class="note">${formatReviewDate(m.date)}</span>${m.role === 'Walid' && m.correctionType && m.correctionType !== 'Aucun type particulier' ? `<span class="review-tag ${reviewTagClass(m.correctionType)}">${esc(m.correctionType)}</span>` : ''}</div><p>${esc(m.text)}</p></article>`,
      )
      .join('') ||
    '<p class="note">Aucun échange pour le moment. Tes messages resteront séparés de l’historique des revues.</p>';
  return `<section class="card space"><h3>Échange avec l’IA</h3><p class="note">Tu peux poser une question ou demander une correction ici. Ces messages n’ajoutent rien à l’historique des revues.</p><div>${messages}</div><label for="reviewType-${id}">Type de correction</label><select id="reviewType-${id}"><option>Aucun type particulier</option><option>Correction mineure</option><option>Erreur de fait / à refaire</option><option>Changement de stratégie</option></select><p class="note">Ce choix aide l’IA à comprendre l’impact de ta remarque. Il ne déclenche pas automatiquement une nouvelle action.</p><label for="reviewMessage-${id}">Ton message</label><textarea id="reviewMessage-${id}" placeholder="Écris tes remarques ou les corrections que tu demandes à l’IA…"></textarea><div class="actions">${btn('Envoyer à l’IA', `sendReviewMessage('${id}')`)}${stateIsAwaitingWalid(t) ? btn('Envoyer et demander une correction', `sendReviewMessage('${id}',true)`) : ''}</div></section>`;
}
function stateIsAwaitingWalid(t) {
  return (t.reviewState || '') === 'En attente de validation par Walid';
}
function latestReview(t) {
  return [...(t.reviewHistory || [])].sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)))[0];
}
// Une carte par action : son dernier compte rendu, et ce qu'il demande.
function reviewCard(t) {
  const latest = latestReview(t);
  const prog = t.objective && typeof objectiveProgress === 'function' ? objectiveProgress(t) : '';
  let tone, label;
  if (stateIsAwaitingWalid(t)) [tone, label] = ['wait', 'L’agent attend ta validation'];
  else if (t.firstRunPending) [tone, label] = ['wait', 'Premier résultat à valider'];
  else if (/objectif atteint|Fait ✓/.test(prog)) [tone, label] = ['up', 'Objectif atteint'];
  else if (!latest) [tone, label] = ['idle', 'Rien à juger — aucun compte rendu'];
  else if (turnLate(t)) [tone, label] = ['down', 'Compte rendu en retard'];
  else [tone, label] = ['idle', 'Dernier compte rendu'];
  const when = latest ? shortDay(latest.at || latest.date) + ' · ' : '';
  const body = latest
    ? `${esc(latest.aiObservation || '')}${latest.aiDecision ? `<br><span style="color:var(--text-3)">Décision : ${esc(latest.aiDecision)}</span>` : ''}`
    : turnLate(t)
      ? 'L’agent n’a rien écrit pour cette action depuis longtemps. Ce n’est pas un échec de l’action : c’est une absence de données.'
      : 'L’agent n’a pas encore rendu de compte pour cette action.';
  let acts = '';
  if (stateIsAwaitingWalid(t)) acts += btn('Valider le constat', `walidApproveReview('${t.id}')`, 'wait');
  acts += btn('Voir le détail et répondre', `reviewDetail('${t.id}')`);
  return `<section class="card acard${tone === 'wait' ? ' cwait' : ''}"><div class="ahead"><span class="astate c-${tone}">${label}</span><span class="note">${when}${esc(
    t.title,
  )}</span></div><p class="adesc" style="-webkit-line-clamp:6;color:${latest ? 'var(--text-2)' : 'var(--muted)'}">${body}</p>${
    prog ? `<p class="note" style="margin:10px 0 0">Objectif : ${prog}</p>` : ''
  }<div class="actions">${acts}</div></section>`;
}
function reviewDetail(id) {
  let t = task(id);
  if (!t) return;
  let state = t.reviewState || 'À examiner par l’agent';
  let controls =
    state === 'En attente de validation par Walid'
      ? `<p class="strip">L’IA a terminé son constat et te soumet son analyse pour validation.</p><div class="actions">${btn('Valider le constat', `walidApproveReview('${id}')`, 'good')}</div>`
      : state === 'Validé par Walid'
        ? `<p class="strip">Tu as validé le dernier constat de l’IA.</p>${btn('Lancer une nouvelle revue', `resetReview('${id}')`)}`
        : state === 'Repris en exécution'
          ? `<p class="strip">L’IA a repris cette action en exécution. Le résultat sera examiné de nouveau ensuite.</p>${btn('Relancer la revue', `resetReview('${id}')`)}`
          : `<p class="strip">L’IA examine le résultat. Elle peut poursuivre les idées déjà approuvées, les modifier librement ou proposer une nouvelle action à valider.</p>`;
  modal(
    'Révision · ' + t.title,
    `<div class="toolbar">${pill(state)}<span class="badge gold">${esc(reviewCadenceFor(t))}</span></div><section class="card space"><h3>Objectif de l’action</h3><p>${esc(t.goal)}</p><p class="note">Indicateur : ${esc(t.metric || 'À préciser')}</p></section><section class="card space"><h3>Résultat actuel</h3>${reviewResultSummary(t)}<label>Résultat observé</label><textarea id="reviewResult-${id}" oninput="saveReviewResult('${id}',this.value)" placeholder="Résultat ou mesure de l’action…">${esc(t.reviewResult || '')}</textarea></section><section class="card space"><div class="heading"><div><h3>Historique des revues</h3><p class="note">Les constats et décisions de cette liste sont rédigés par l’IA. Tes messages sont conservés à part.</p></div></div>${reviewHistoryMarkup(t)}</section><section class="card space"><label>Prochaine revue</label><select onchange="setReviewCadence('${id}',this.value)"><option ${reviewCadenceFor(t) === 'Chaque jour' ? 'selected' : ''}>Chaque jour</option><option ${reviewCadenceFor(t) === 'Chaque lundi' ? 'selected' : ''}>Chaque lundi</option></select></section>${controls}${reviewConversationPanel(t, id)}`,
  );
}
function saveReviewResult(id, value) {
  let t = task(id);
  if (t) {
    t.reviewResult = value;
    save();
  }
}
function setReviewCadence(id, value) {
  let t = task(id);
  if (t) {
    t.reviewCadence = value;
    save();
  }
}
function recordAIReview(t, decision, observation, plan = '') {
  t.reviewHistory = t.reviewHistory || [];
  t.reviewHistory.unshift({
    date: new Date().toISOString().slice(0, 10),
    aiObservation: observation,
    aiDecision: decision,
    plan,
  });
}
function agentApproveReview(id) {
  let t = task(id);
  if (!t) return;
  let result = (t.reviewResult || '').trim();
  recordAIReview(
    t,
    'L’IA valide le constat et soumet son analyse à Walid',
    result
      ? 'Résultat analysé par l’IA : ' + result
      : 'L’IA a examiné le résultat actuel de cette action. Elle estime que les données disponibles permettent de poursuivre le suivi.',
    'L’IA recommande de continuer avec les idées déjà approuvées, sauf proposition nouvelle soumise à Walid.',
  );
  t.reviewState = 'En attente de validation par Walid';
  save();
  reviewDetail(id);
}
function agentReturnToExecution(id) {
  let t = task(id);
  if (!t) return;
  let result = (t.reviewResult || '').trim();
  recordAIReview(
    t,
    'L’IA reprend l’action en exécution',
    result
      ? 'Après analyse du résultat (« ' +
          result +
          ' »), l’IA estime qu’un nouveau passage par l’exécution est nécessaire.'
      : 'Après examen, l’IA estime que cette action doit repasser par l’exécution avant une nouvelle revue.',
  );
  t.reviewState = 'Repris en exécution';
  t.status = 'En cours';
  save();
  reviewDetail(id);
}
function walidApproveReview(id) {
  let t = task(id);
  if (!t) return;
  t.reviewState = 'Validé par Walid';
  save();
  render();
  reviewDetail(id);
}
function sendReviewMessage(id, requestCorrection = false) {
  let t = task(id);
  if (!t) return;
  let field = document.getElementById('reviewMessage-' + id),
    typeField = document.getElementById('reviewType-' + id),
    message = (field?.value || '').trim();
  if (!message) {
    notify('Écris ton message à l’IA avant de l’envoyer.');
    return;
  }
  t.reviewConversation = t.reviewConversation || [];
  t.reviewConversation.push({
    role: 'Walid',
    date: new Date().toISOString().slice(0, 10),
    text: message,
    correctionType: typeField?.value || 'Aucun type particulier',
  });
  if (requestCorrection) {
    t.reviewState = 'Repris en exécution';
    t.status = 'En cours';
  }
  save();
  reviewDetail(id);
  notify(
    requestCorrection
      ? 'Ta demande de correction a été transmise à l’IA.'
      : 'Ton message a été ajouté à l’échange avec l’IA.',
  );
}
function resetReview(id) {
  let t = task(id);
  if (!t) return;
  t.reviewState = 'À examiner par l’agent';
  save();
  reviewDetail(id);
}
function revision() {
  const list = data.tasks.filter((t) => t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected');
  const rank = (t) => (stateIsAwaitingWalid(t) || t.firstRunPending ? 0 : latestReview(t) ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || String((latestReview(b) || {}).at || '').localeCompare(String((latestReview(a) || {}).at || '')));
  return (
    head('Révision', 'L’agent contrôle son propre travail et rend ses comptes. Ce qu’il n’a pas pu juger est dit tel quel.') +
    `<div class="cards">${list.map(reviewCard).join('') || '<div class="empty">Aucune action à réviser.</div>'}</div><details class="card" style="margin-top:26px"><summary style="cursor:pointer;font-weight:600">Consignes de l’agent pour le prochain cycle</summary><p class="note">Après l’examen des résultats, tu peux ajuster les consignes pour le prochain cycle.</p><label>Structure du script</label><textarea id="promptStructure">${esc(data.prompt.structure)}</textarea><label>Ton / style du projet</label><input id="promptTone" value="${esc(data.prompt.tone)}"><label>Outil ou méthode de production</label><input id="promptVoice" value="${esc(data.prompt.voice)}"><div class="actions">${btn('Enregistrer les consignes', 'savePrompt()', 'primary')}</div></details>`
  );
}
function savePrompt() {
  data.prompt = {
    structure: document.getElementById('promptStructure').value,
    tone: document.getElementById('promptTone').value,
    voice: document.getElementById('promptVoice').value,
  };
  data.method = true;
  save();
  render();
  notify('Nouvelle version des consignes enregistrée en simulation.');
}
function resetPrompt() {
  data.prompt = {
    structure: 'Hook (0–3 s) → problème → conseil concret → conclusion',
    tone: 'Direct, accessible et pédagogique',
    voice: 'Voix française posée et naturelle',
  };
  save();
  render();
  notify('Consignes de démonstration rétablies.');
}
function note(v) {
  data.notes[page] = v;
  save();
}

const MONEY_PROJECTS = [...LA.projects.map((p) => p.name), 'Commun (plusieurs projets)'];
const moneySeed = { expenses: [], invoices: [], corrections: [], ai: [] };
let moneyData = null,
  moneyFilter = 'Tous',
  moneyQuery = '',
  moneyExpand = { exp: false, inv: false, corr: false, hist: false, proj: false },
  moneyGroups = {};
function moneyKey() {
  return 'money';
}
function loadMoney() {
  try {
    let r = LA.get(moneyKey());
    if (r) return JSON.parse(r);
  } catch {}
  return JSON.parse(JSON.stringify(moneySeed));
}
function saveMoney() {
  try {
    LA.set(moneyKey(), JSON.stringify(moneyData));
  } catch {}
}
function nb(n) {
  let v = Math.round(n * 100) / 100;
  return v.toLocaleString(
    'fr-FR',
    Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
}
function amt(n, c) {
  return nb(n) + ' ' + c;
}
function sumFmt(o) {
  let p = Object.keys(o)
    .filter((c) => Math.round(o[c] * 100) !== 0)
    .map((c) => amt(o[c], c));
  return p.length ? p.join(' + ') : '—';
}
function addTo(o, c, v) {
  if (v) o[c] = (o[c] || 0) + v;
  return o;
}
function monthly(e) {
  return e.freq === 'mois' ? e.amount : e.freq === 'an' ? e.amount / 12 : 0;
}
function fdate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
function monthKey(d) {
  return (d || '').slice(0, 7);
}
function monthLabel(k) {
  let [y, m] = k.split('-');
  return new Date(y, m - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .replace(/^./, (c) => c.toUpperCase());
}
function subsActiveIn(k) {
  return moneyData.expenses.filter((e) => e.freq !== 'une fois' && (!e.since || e.since <= k));
}
function rechargesIn(k) {
  return moneyData.expenses.filter((e) => e.freq === 'une fois' && monthKey(e.date) === k);
}
function allMonths() {
  let ks = new Set();
  moneyData.expenses.forEach((e) => {
    if (e.freq === 'une fois' && e.date) ks.add(monthKey(e.date));
    if (e.since) ks.add(e.since);
  });
  ks.add(new Date().toISOString().slice(0, 7));
  let arr = [...ks].sort();
  let out = [],
    cur = arr[0],
    last = arr[arr.length - 1];
  while (cur <= last) {
    out.push(cur);
    let [y, m] = cur.split('-').map(Number);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    cur = y + '-' + String(m).padStart(2, '0');
  }
  return out.reverse();
}
// Prochaine échéance d'un abonnement : la date de paiement avancée de mois en mois
// (ou d'année en année) jusqu'à aujourd'hui ou après.
function nextDue(e) {
  let [y, m, d] = String(e.date).split('-').map(Number);
  if (!y || !m || !d) return e.date;
  const today = new Date().toISOString().slice(0, 10);
  const iso = () => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
  };
  for (let i = 0; i < 600 && iso() < today; i++) {
    if (e.freq === 'an') y++;
    else if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return iso();
}
function invoiceUpToDate(e) {
  if (!e.invoice) return false;
  let d = (new Date() - new Date(e.invoice.date)) / 86400000;
  return e.freq === 'mois' ? d < 35 : e.freq === 'an' ? d < 366 : true;
}
// ---------- tuiles ----------
function moneyTiles() {
  let now = new Date().toISOString().slice(0, 7);
  let fixed = {},
    month = {},
    r30 = {};
  subsActiveIn(now).forEach((e) => {
    addTo(fixed, e.cur, monthly(e));
    addTo(month, e.cur, monthly(e));
  });
  rechargesIn(now).forEach((e) => addTo(month, e.cur, e.amount));
  moneyData.expenses
    .filter((e) => e.freq === 'une fois' && e.date)
    .forEach((e) => {
      let d = (new Date() - new Date(e.date)) / 86400000;
      if (d >= 0 && d <= 30) addTo(r30, e.cur, e.amount);
    });
  // Recharges des 30 jours précédents, pour dire si ça monte ou baisse (par devise, jamais additionnées).
  let r60 = {};
  moneyData.expenses
    .filter((e) => e.freq === 'une fois' && e.date)
    .forEach((e) => {
      let d = (new Date() - new Date(e.date)) / 86400000;
      if (d > 30 && d <= 60) addTo(r60, e.cur, e.amount);
    });
  let curs = [...new Set([...Object.keys(r30), ...Object.keys(r60)])];
  let trendR = '';
  if (curs.length === 1) {
    let c = curs[0],
      diff = Math.round(((r30[c] || 0) - (r60[c] || 0)) * 100) / 100;
    if (diff)
      trendR = `<div class="${diff < 0 ? 'c-up' : 'c-down'}">${diff < 0 ? '▼' : '▲'} ${amt(Math.abs(diff), c)} ${diff < 0 ? 'de moins' : 'de plus'} que les 30 jours d’avant</div>`;
  }
  let total = moneyData.expenses.length,
    ok = moneyData.expenses.filter(invoiceUpToDate).length,
    missing = total - ok;
  let t = [
    ['Ce mois-ci', sumFmt(month), '<div class="tiny">abonnements et recharges du mois</div>', ''],
    ['Fixe chaque mois', sumFmt(fixed), '<div class="tiny">abonnements, domaines lissés sur 12 mois</div>', ''],
    ['Recharges, 30 derniers jours', sumFmt(r30), trendR || '<div class="tiny">paiements « une fois » récents</div>', ''],
    !total
      ? ['Factures', '—', '<div class="tiny">aucune dépense enregistrée</div>', '']
      : missing
      ? ['Lignes sans facture à jour', `${missing} sur ${total}`, '<div class="c-wait">à rattacher</div>', 'wait']
      : ['Factures', `${ok} sur ${total}`, '<div class="c-up">toutes à jour</div>', ''],
  ];
  return `<div class="mgrid">${t
    .map(
      (x) =>
        `<section class="tile${x[3] ? ' cwait' : ''}"><div class="tiny">${esc(x[0])}</div><strong class="num${x[3] ? ' c-wait' : ''}" style="font-size:1.5rem;display:block;margin:8px 0 6px">${esc(
          x[1],
        )}</strong><div style="font-size:12px">${x[2]}</div></section>`,
    )
    .join('')}</div>`;
}
// ---------- factures ----------
function moneyInvoices() {
  let inv = moneyData.invoices,
    shown = moneyExpand.inv ? inv : inv.slice(0, 2);
  let rows = shown
    .map((f) => {
      let body =
        f.state === 'lecture'
          ? '<span class="tiny">en attente de lecture par Claude (à son prochain passage)</span>'
          : f.state === 'pas-facture'
            ? '<span class="tiny">ce document ne ressemble pas à une facture</span>'
            : f.state === 'doublon'
              ? `<span class="tiny">même paiement que ${esc(f.dup)} : compté une seule fois</span>`
              : `${esc(f.vendor)} · <strong>${amt(f.amount, f.cur)}</strong> · ${fdate(f.date)}${f.period && f.period !== '—' ? ' (' + esc(f.period) + ')' : ''}<br>${f.match ? `<span class="mok">→ ${esc(f.match)}</span>` : `<span class="mwarn">ne correspond à aucune ligne</span>`}`;
      let add = f.state === 'lue' && !f.match ? btn('Ajouter à la liste', `addFromInvoice('${f.id}')`, 'good') : '';
      return `<div class="mrow"><div style="flex:1"><strong>${f.fileId ? `<a href="/api/files/${encodeURIComponent(f.fileId)}" target="_blank" rel="noopener">${esc(f.file)}</a>` : esc(f.file)}</strong><p style="margin:4px 0 0">${body}</p>${add ? '<div class="actions" style="margin-top:8px">' + add + '</div>' : ''}</div><div style="display:flex;gap:6px">${btn('↻', `rereadInvoice('${f.id}')`)}${btn('✕', `deleteInvoice('${f.id}')`)}</div></div>`;
    })
    .join('');
  let more =
    inv.length > 2
      ? `<div class="actions">${btn(moneyExpand.inv ? 'Voir moins' : 'Voir ' + (inv.length - 2) + ' facture(s) de plus', 'toggleMoney("inv")')}</div>`
      : '';
  let cs = moneyData.corrections.filter((c) => !c.undone),
    cshown = moneyExpand.corr ? cs : cs.slice(0, 2);
  let corr = cs.length
    ? `<section class="tile" style="margin-top:16px"><strong>Corrigé d’après tes factures</strong>${cshown.map((c) => `<div class="mrow"><div>${esc(c.label)} : ${esc(c.detail)}</div>${btn('Annuler', `undoCorrection('${c.id}')`)}</div>`).join('')}${cs.length > 2 ? `<div class="actions">${btn(moneyExpand.corr ? 'Voir moins' : 'Voir ' + (cs.length - 2) + ' correction(s) de plus', 'toggleMoney("corr")')}</div>` : ''}</section>`
    : '';
  return `<section class="tile"><h2 style="margin-top:0">Factures</h2><label class="mdrop" ondragover="event.preventDefault()" ondrop="dropInvoices(event)"><strong>Dépose tes factures ici</strong><div class="tiny">ou clique pour les choisir · PDF ou photo · 10 Mo max</div><input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onchange="uploadInvoices(this.files);this.value=''"></label>${rows}${more}${corr}<p class="tiny" style="margin-top:12px">Claude lit chaque facture à son prochain passage, sur ton abonnement (aucun coût par facture), et la rapproche de ta liste.</p></section>`;
}
// ---------- coût IA ----------
function moneyAI() {
  return `<section class="tile"><h2 style="margin-top:0">Ce que l’IA du cerveau coûte ce mois-ci</h2><table class="mtbl"><thead><tr><th>Usage</th><th class="r">Ce mois</th><th class="r">Plafond</th></tr></thead><tbody>${moneyData.ai.map((r) => `<tr><td>${esc(r.usage)}</td><td class="r">${amt(r.month, '$')}</td><td class="r">${amt(r.cap, '$')}</td></tr>`).join('')}</tbody></table><p class="tiny">Chaque usage a son plafond : atteint, il s’arrête jusqu’au mois suivant et le dit, rien ne déborde.</p></section>`;
}
// ---------- dépenses ----------
function moneyExpenses() {
  let ex = moneyData.expenses.filter(
    (e) =>
      (moneyFilter === 'Tous' || e.project === moneyFilter) &&
      (!moneyQuery || e.name.toLowerCase().includes(moneyQuery.toLowerCase())),
  );
  let groups = {};
  ex.forEach((e) => {
    let k = e.name.toLowerCase();
    (groups[k] = groups[k] || []).push(e);
  });
  let ord = { mois: 0, an: 1, 'une fois': 2 };
  let entries = Object.keys(groups)
    .map((k) => groups[k])
    .sort(
      (a, b) =>
        ord[a[0].freq] - ord[b[0].freq] || new Date(b[0].date || '2000-01-01') - new Date(a[0].date || '2000-01-01'),
    );
  let shown = moneyExpand.exp ? entries : entries.slice(0, 8);
  let rows = shown
    .map((g) => {
      if (g.length === 1) {
        let e = g[0];
        return expenseRow(e, '');
      }
      let tot = {};
      g.forEach((e) => addTo(tot, e.cur, e.amount));
      let open = moneyGroups[g[0].name.toLowerCase()];
      let head = `<tr class="mgrp" onclick="toggleGroup('${g[0].name.toLowerCase().replace(/'/g, "\\'")}')"><td><strong>${open ? '▾' : '▸'} ${esc(g[0].name)}</strong><br><span class="tiny">${esc([...new Set(g.map((e) => e.project))].join(' · '))}</span></td><td class="r"><strong>${sumFmt(tot)}</strong><br><span class="tiny">${g.length} paiements</span></td><td>dernier : ${fdate(
        g
          .map((e) => e.date)
          .filter(Boolean)
          .sort()
          .pop(),
      )}</td><td></td><td></td></tr>`;
      return head + (open ? g.map((e) => expenseRow(e, 'style="opacity:.8"')).join('') : '');
    })
    .join('');
  let more =
    entries.length > 8
      ? `<div class="actions">${btn(moneyExpand.exp ? 'Voir moins' : 'Voir plus (' + (entries.length - 8) + ')', 'toggleMoney("exp")')}</div>`
      : '';
  let filters = ['Tous', ...MONEY_PROJECTS]
    .map(
      (p) =>
        `<button class="${moneyFilter === p ? 'active' : ''}" onclick="setMoneyFilter('${p.replace(/'/g, "\\'")}')">${esc(p)}</button>`,
    )
    .join('');
  return `<section class="tile"><h2 style="margin-top:0">Dépenses</h2><div class="filters">${filters}</div><input placeholder="Rechercher une dépense…" value="${esc(moneyQuery)}" oninput="setMoneyQuery(this.value)" style="margin:10px 0"><table class="mtbl"><thead><tr><th>Dépense</th><th class="r">Montant</th><th>Quand</th><th>Facture</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">Aucune dépense.</td></tr>'}</tbody></table>${more}<p class="tiny">Les dépenses du même nom (ex. les recharges Anthropic) sont regroupées : clique sur ▸ pour voir chaque paiement.</p><div class="actions">${btn('Ajouter une dépense', 'addExpense()')}</div></section>`;
}
function expenseRow(e, attr) {
  let quand =
    e.freq === 'une fois'
      ? fdate(e.date)
      : e.date
        ? 'prochain : ' + fdate(nextDue(e))
        : '<span class="mwarn">date à préciser</span>';
  // Doré : une facture à rattacher (absente ou trop ancienne). Vert : à jour.
  let inv = !e.invoice
    ? '<span class="mwarn">Pas de facture</span>'
    : (invoiceUpToDate(e)
        ? '<span class="mok">' + fdate(e.invoice.date) + '</span>'
        : '<span class="mwarn">Datant du ' + fdate(e.invoice.date) + '</span>') +
      (Math.round(e.invoice.amount * 100) !== Math.round(e.amount * 100)
        ? `<br><span class="mwarn tiny">${amt(e.invoice.amount, e.cur)} sur la facture</span>`
        : '');
  return `<tr ${attr}><td><strong>${esc(e.name)}</strong><br><span class="tiny">${esc(e.project)}</span></td><td class="r">${amt(e.amount, e.cur)}<br><span class="tiny">${e.freq === 'une fois' ? 'une fois' : 'par ' + e.freq}</span></td><td>${quand}</td><td>${inv}</td><td class="r" style="white-space:nowrap">${btn('Modifier', `editExpense('${e.id}')`)}${btn('✕', `removeExpense('${e.id}')`)}</td></tr>`;
}
// ---------- historique ----------
function moneyHistory() {
  let months = allMonths(),
    now = new Date().toISOString().slice(0, 7);
  let shown = moneyExpand.hist ? months : months.slice(0, 3);
  let rows = shown
    .map((k) => {
      let subs = subsActiveIn(k),
        rech = rechargesIn(k),
        tot = {};
      let sc =
        subs
          .map((e) => {
            let v = monthly(e);
            addTo(tot, e.cur, v);
            return `<div class="mline"><span>${esc(e.name)}</span><span>${amt(v, e.cur)}</span></div>`;
          })
          .join('') || '<span class="tiny">—</span>';
      let rc =
        rech
          .map((e) => {
            addTo(tot, e.cur, e.amount);
            return `<div class="mline"><span>${esc(e.name)}</span><span>${amt(e.amount, e.cur)}</span></div>`;
          })
          .join('') || '<span class="tiny">—</span>';
      return `<tr><td style="vertical-align:top"><strong>${monthLabel(k)}</strong>${k === now ? '<br><span class="tiny">en cours</span>' : ''}</td><td style="vertical-align:top">${sc}</td><td style="vertical-align:top">${rc}</td><td class="r" style="vertical-align:top"><strong>${sumFmt(tot)}</strong></td></tr>`;
    })
    .join('');
  let year = {},
    all = {};
  months.forEach((k) => {
    subsActiveIn(k).forEach((e) => {
      addTo(all, e.cur, monthly(e));
      if (k.startsWith('2026')) addTo(year, e.cur, monthly(e));
    });
    rechargesIn(k).forEach((e) => {
      addTo(all, e.cur, e.amount);
      if (k.startsWith('2026')) addTo(year, e.cur, e.amount);
    });
  });
  let more =
    months.length > 3
      ? `<div class="actions">${btn(moneyExpand.hist ? 'Voir moins' : 'Voir ' + (months.length - 3) + ' mois de plus', 'toggleMoney("hist")')}</div>`
      : '';
  return `<section class="tile"><h2 style="margin-top:0">Historique</h2><table class="mtbl"><thead><tr><th>Mois</th><th>Abonnements</th><th>Recharges</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>${more}<p style="margin-top:12px"><strong>2026 : ${sumFmt(year)}</strong> &nbsp;&nbsp; Depuis ${monthLabel(months[months.length - 1])} : <strong>${sumFmt(all)}</strong></p><p class="tiny">Rien ne s’efface d’un mois sur l’autre : les recharges restent à leur date, les abonnements comptent chaque mois (domaines lissés sur 12 mois).</p></section>`;
}
// ---------- par projet ----------
function moneyByProject() {
  let months = allMonths(),
    now = new Date().toISOString().slice(0, 7);
  let used = MONEY_PROJECTS.filter((p) => moneyData.expenses.some((e) => e.project === p));
  let shown = moneyExpand.proj ? months : months.slice(0, 3);
  let rows = shown
    .map((k) => {
      let cells = used
        .map((p) => {
          let list = [...subsActiveIn(k), ...rechargesIn(k)].filter((e) => e.project === p),
            st = {};
          let body = list
            .map((e) => {
              let v = e.freq === 'une fois' ? e.amount : monthly(e);
              addTo(st, e.cur, v);
              return `<div class="mline"><span>${esc(e.name)}</span><span>${amt(v, e.cur)}</span></div>`;
            })
            .join('');
          return `<td style="vertical-align:top">${body || '<span class="tiny">—</span>'}${body ? `<div class="msub">${sumFmt(st)}</div>` : ''}</td>`;
        })
        .join('');
      return `<tr><td style="vertical-align:top"><strong>${monthLabel(k)}</strong>${k === now ? '<br><span class="tiny">en cours</span>' : ''}</td>${cells}</tr>`;
    })
    .join('');
  let totals = used
    .map((p) => {
      let t = {};
      months.forEach((k) =>
        [...subsActiveIn(k), ...rechargesIn(k)]
          .filter((e) => e.project === p)
          .forEach((e) => addTo(t, e.cur, e.freq === 'une fois' ? e.amount : monthly(e))),
      );
      return `<td class="r"><strong>${sumFmt(t)}</strong></td>`;
    })
    .join('');
  let more =
    months.length > 3
      ? `<div class="actions">${btn(moneyExpand.proj ? 'Voir moins' : 'Voir ' + (months.length - 3) + ' mois de plus', 'toggleMoney("proj")')}</div>`
      : '';
  return `<section class="tile"><h2 style="margin-top:0">Par projet</h2><div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Mois</th>${used.map((p) => `<th>${esc(p)}</th>`).join('')}</tr></thead><tbody>${rows}<tr><td><strong>Total</strong><br><span class="tiny">depuis ${monthLabel(months[months.length - 1])}</span></td>${totals}</tr></tbody></table></div>${more}<p class="tiny">Les dépenses partagées sont dans « Commun ». Abonnements comptés chaque mois (domaines lissés sur 12 mois), recharges à leur date.</p></section>`;
}
// ---------- actions ----------
function toggleMoney(k) {
  moneyExpand[k] = !moneyExpand[k];
  render();
}
function toggleGroup(n) {
  moneyGroups[n] = !moneyGroups[n];
  render();
}
function setMoneyFilter(p) {
  moneyFilter = p;
  render();
}
function setMoneyQuery(q) {
  moneyQuery = q;
  main.innerHTML = moneyPageHtml();
  let el = main.querySelector('input[placeholder^="Rechercher"]');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}
function removeExpense(id) {
  if (!confirm('Retirer cette dépense ?')) return;
  moneyData.expenses = moneyData.expenses.filter((e) => e.id !== id);
  saveMoney();
  render();
  notify('Dépense retirée.');
}
function deleteInvoice(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  moneyData.invoices = moneyData.invoices.filter((f) => f.id !== id);
  saveMoney();
  render();
  notify('Facture supprimée.');
}
function undoCorrection(id) {
  let c = moneyData.corrections.find((x) => x.id === id);
  if (c) c.undone = true;
  saveMoney();
  render();
  notify('Correction annulée.');
}
function addFromInvoice(id) {
  let f = moneyData.invoices.find((x) => x.id === id);
  if (!f) return;
  moneyData.expenses.push({
    id: 'e' + Date.now(),
    name: f.vendor,
    amount: f.amount,
    cur: f.cur,
    freq: 'une fois',
    date: f.date,
    project: 'Commun (plusieurs projets)',
    invoice: { date: f.date, amount: f.amount },
  });
  f.match = f.vendor;
  saveMoney();
  render();
  notify('Dépense ajoutée depuis la facture.');
}
function expenseForm(e) {
  let v = e || {
    name: '',
    amount: '',
    cur: '€',
    freq: 'une fois',
    date: new Date().toISOString().slice(0, 10),
    project: 'Commun (plusieurs projets)',
  };
  return `<label>Nom<input id="exName" maxlength="80" value="${esc(v.name)}"></label><label>Montant<input id="exAmount" value="${esc(String(v.amount))}" placeholder="0,00"></label><label>Devise<select id="exCur">${['€', '$'].map((c) => `<option ${c === v.cur ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Fréquence<select id="exFreq">${['mois', 'an', 'une fois'].map((f) => `<option ${f === v.freq ? 'selected' : ''}>${f}</option>`).join('')}</select></label><label>Date<input type="date" id="exDate" value="${esc(v.date || '')}"></label><label>Projet<select id="exProject">${MONEY_PROJECTS.map((p) => `<option ${p === v.project ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><div class="actions">${btn(e ? 'Enregistrer' : 'Ajouter', e ? `saveExpense('${e.id}')` : 'saveExpense()', 'good')}</div>`;
}
function addExpense() {
  modal('Ajouter une dépense', expenseForm(null));
}
function editExpense(id) {
  let e = moneyData.expenses.find((x) => x.id === id);
  if (e) modal('Modifier la dépense', expenseForm(e));
}
function saveExpense(id) {
  let name = document.getElementById('exName').value.trim(),
    amount = parseFloat(document.getElementById('exAmount').value.replace(',', '.'));
  if (!name) return notify('Le nom est obligatoire.');
  if (!(amount > 0 && amount <= 100000)) return notify('Montant invalide.');
  let o = {
    name,
    amount: Math.round(amount * 100) / 100,
    cur: document.getElementById('exCur').value,
    freq: document.getElementById('exFreq').value,
    date: document.getElementById('exDate').value,
    project: document.getElementById('exProject').value,
  };
  if (o.freq === 'une fois' && !o.date) return notify('La date est obligatoire pour une dépense « une fois ».');
  if (o.freq !== 'une fois') o.since = o.since || new Date().toISOString().slice(0, 7);
  if (id) {
    Object.assign(
      moneyData.expenses.find((x) => x.id === id),
      o,
    );
  } else {
    moneyData.expenses.push({ id: 'e' + Date.now(), invoice: null, ...o });
  }
  saveMoney();
  closeDialog();
  render();
  notify(id ? 'Dépense modifiée.' : 'Dépense ajoutée.');
}
function moneyPageHtml() {
  return `<div class="strip" style="margin-bottom:24px;font-size:13px;color:var(--text-2)">Cette page couvre les ${projects.length} projets. Le sélecteur de projet n’a pas d’effet ici.</div><div class="heading"><div><h1>Argent</h1><p class="intro">Ce que coûtent les projets. Les euros et les dollars ne sont jamais additionnés.</p></div></div>${moneyTiles()}${moneyInvoices()}${moneyAI()}${moneyExpenses()}${moneyHistory()}${moneyByProject()}`;
}
function permanentLoops(pid, pname) {
  const extra = ((projects.find((x) => x.id === pid) || {}).extraLoops || []).map((d) => ({
    id: pid + '-' + d.suffix,
    title: d.title,
    origin: 'Agent',
    owner: 'Agent',
    goal: d.goal,
    metric: d.metric,
    status: 'En cours',
    type: 'Boucle',
    freq: d.freq,
    category: 'Autre',
    autonomy: 'autonome',
    permanent: true,
    ideas: [...d.ideas],
  }));
  return [...extra, ...baseLoops(pid, pname)];
}
function baseLoops(pid, pname) {
  return [
    {
      id: pid + '-mails',
      title: 'Lire les réponses reçues',
      origin: 'Agent',
      owner: 'Agent',
      goal: 'Savoir ce que les gens répondent vraiment, pour nourrir la mémoire du projet.',
      metric: 'Vraies réponses humaines classées',
      status: 'En cours',
      type: 'Boucle',
      freq: 'Chaque jour',
      category: 'Autre',
      autonomy: 'autonome',
      permanent: true,
      ideas: [
        'Lire les boîtes qui concernent ce projet',
        'Classer : refus, question, rendez-vous, absence',
        'Écarter les réponses automatiques et les boîtes pleines',
        'Verser le constat en mémoire',
      ],
    },
    {
      id: pid + '-stats',
      title: 'Surveiller les statistiques',
      origin: 'Agent',
      owner: 'Agent',
      goal: 'Comparer les résultats dans le temps et créer une action quand un écart le justifie.',
      metric: 'Écarts repérés et actions créées',
      status: 'En cours',
      type: 'Boucle',
      freq: 'Chaque jour',
      category: 'Autre',
      autonomy: 'autonome',
      permanent: true,
      ideas: [
        'Relever les chiffres de la période',
        'Comparer aux périodes précédentes',
        'Repérer ce qui change vraiment',
        'Proposer une action si l’écart le justifie',
      ],
    },
    {
      id: pid + '-veille',
      title: 'Veille extérieure',
      origin: 'Agent',
      owner: 'Agent',
      goal: 'Repérer ailleurs ce qui mérite d’être essayé ici.',
      metric: 'Pistes retenues et testées',
      status: 'En cours',
      type: 'Boucle',
      freq: 'Chaque semaine',
      category: 'Autre',
      autonomy: 'autonome',
      permanent: true,
      ideas: [
        'Observer ce que font les autres sur ce terrain',
        'Repérer les formats et méthodes qui marchent',
        'Évaluer ce qui est transposable ici',
        'Proposer un test',
      ],
    },
  ];
}

function taskAutonomy(t) {
  return t.autonomy || (t.proposalStatus === 'pending' ? 'à valider' : 'première fois à valider');
}
function isStopped(t) {
  return !!t.stopped;
}
// une idée est rouge si elle attend Walid
function ideaIsRed(i) {
  if (!i || typeof i === 'string') return false;
  if (i.source === 'IA' && i.approvalStatus === 'pending') return true;
  if ((i.accessRequests || []).some((a) => !a.connected)) return true;
  if (i.errorState) return true;
  return false;
}
// ---------- Ce qui attend Walid (doré), ce qui dort (gris) ----------
// Une seule source pour le menu, la barre du haut, les bandeaux et les cartes.
function isPaused(t) {
  return !!t.paused || t.status === 'En pause';
}
function isLive(t) {
  return t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected' && !t.done && !isPaused(t);
}
function daysSince(iso) {
  const ms = Date.parse(iso || '');
  return ms ? Math.floor((Date.now() - ms) / 86400000) : null;
}
function agoText(iso) {
  const ms = Date.parse(iso || '');
  if (!ms) return '';
  const h = Math.floor((Date.now() - ms) / 3600000);
  if (h < 1) return 'il y a moins d’une heure';
  if (h < 20) return `il y a ${h} h`;
  const d = Math.max(1, Math.round(h / 24));
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}
function cadenceDays(t) {
  return /jour/i.test(reviewCadenceFor(t)) ? 1 : 7;
}
// Un tour est en retard quand il a manqué plus d'un rendez-vous.
function turnLate(t) {
  if (!isLive(t)) return false;
  const d = daysSince(t.lastAgentTurn || t.decidedAt || t.proposedAt);
  return d !== null && d > cadenceDays(t) + 1;
}
function waitReasons(t) {
  if (t.proposalStatus === 'rejected' || t.done) return [];
  const r = [];
  if (t.proposalStatus === 'pending') {
    const d = daysSince(t.proposedAt);
    r.push({ kind: 'proposition', text: 'L’agent attend ta réponse' + (d ? ` — ${d} jour${d > 1 ? 's' : ''}` : '') });
    return r;
  }
  if (isStopped(t)) r.push({ kind: 'modification', text: 'Arrêtée : une modification attend ta décision' });
  if (t.firstRunPending && !isPaused(t)) r.push({ kind: 'premier', text: 'Premier résultat à valider' });
  if (t.status === 'En attente de validation Walid') r.push({ kind: 'validation', text: 'Attend ta validation' });
  const ideas = (t.ideas || []).filter(ideaIsRed).length;
  if (ideas) r.push({ kind: 'idee', text: `${ideas} idée${ideas > 1 ? 's attendent' : ' attend'} ta décision` });
  if (stateIsAwaitingWalid(t)) r.push({ kind: 'constat', text: 'Un constat attend ta validation' });
  if (!isPaused(t)) {
    if (!t.objective) r.push({ kind: 'objectif', text: 'Sans objectif, rien ne peut être jugé' });
    else if (t.objective.setBy !== 'walid') r.push({ kind: 'objectif-suggere', text: 'Objectif suggéré par l’agent, à confirmer' });
  }
  return r;
}
function taskColor(t) {
  if (isPaused(t)) return 'gris';
  if (waitReasons(t).length) return 'rouge';
  return 'vert';
}
// La ligne d'état en tête de carte : { tone: wait | up | down | idle, text }.
function stateLine(t, page = 'planification') {
  if (t.proposalStatus === 'rejected') return { tone: 'down', text: 'Refusée par toi' };
  if (t.done) return { tone: 'up', text: 'Terminée' + (t.doneAt ? ' le ' + shortDay(t.doneAt) : '') };
  if (isPaused(t)) return { tone: 'idle', text: 'En pause' };
  const w = page === 'execution' ? [] : waitReasons(t);
  if (w.length) return { tone: 'wait', text: w[0].text + (w.length > 1 ? ` · et ${w.length - 1} autre${w.length > 2 ? 's' : ''} chose${w.length > 2 ? 's' : ''}` : '') };
  if (!t.lastAgentTurn) return { tone: 'idle', text: 'Aucun tour enregistré' };
  if (turnLate(t)) return { tone: 'down', text: 'Dernier tour ' + agoText(t.lastAgentTurn) };
  if (page === 'execution') return { tone: 'up', text: 'Dernier tour ' + agoText(t.lastAgentTurn) };
  return { tone: 'up', text: 'Tourne seule, rien à faire' };
}
const MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function shortDay(iso) {
  const d = new Date(iso);
  return isNaN(d) ? esc(iso || '') : `${d.getDate()} ${MOIS_FR[d.getMonth()]}`;
}
function metaLine(t) {
  const parts = [t.type === 'Boucle' ? 'Boucle' : 'Ponctuelle'];
  parts.push(t.origin === 'Walid' ? 'ajoutée par toi' : 'proposée par l’agent');
  if (t.type === 'Boucle') parts.push(reviewCadenceFor(t).toLowerCase());
  if (t.category && t.category !== 'Autre') parts.push(t.category);
  return parts.map(esc).join(' · ');
}
function cardHead(t, page) {
  const st = stateLine(t, page);
  return `<div class="ahead"><span class="astate c-${st.tone}">${esc(st.text)}</span><span class="note">${metaLine(t)}</span></div>`;
}
function projectColor(d) {
  let ts = d.tasks || [];
  if (ts.some((t) => taskColor(t) === 'rouge')) return 'rouge';
  if (ts.length && ts.every((t) => taskColor(t) === 'gris')) return 'gris';
  return 'vert';
}
function colorDot(c) {
  // Doré : ça t'attend · gris : en pause · rien à faire : pas de pastille (on ne cherche que le doré).
  if (c === 'vert') return '';
  let m = { rouge: 'var(--wait)', gris: 'var(--idle)' };
  return `<span class="cdot" style="background:${m[c]}" title="${c === 'rouge' ? 'Quelque chose t’attend' : 'En pause'}"></span>`;
}
function projectColorFor(id) {
  try {
    let raw = LA.get(projectKey(id));
    let d = raw ? JSON.parse(raw) : projectDefaults(id);
    if (!d.tasks) d = projectDefaults(id);
    let p = projects.find((x) => x.id === id);
    let tasks = d.tasks.slice();
    permanentLoops(id, p ? p.name : '').forEach((s) => {
      if (!tasks.some((t) => t.id === s.id)) tasks.push(s);
    });
    return projectColor({ tasks });
  } catch {
    return 'vert';
  }
}
// étapes concernées par une action
function stagesFor(t) {
  if (t.type === 'Ponctuelle' && t.done) return ['verification', 'memoire', 'revision'];
  return ['planification', 'execution', 'verification', 'memoire', 'priorites', 'revision'];
}
function showsOn(t, slug) {
  return stagesFor(t).includes(slug);
}
function currentSlug() {
  let s = location.hash.slice(1);
  return slugs.includes(s) ? s : 'planification';
}
function visibleTasks(slug) {
  return data.tasks.filter((t) => showsOn(t, slug));
}
// bandeau d'état posé sur la carte
function autonomyBadge(t) {
  if (t.status === 'En pause') return '<span class="badge">En pause</span>';
  let a = taskAutonomy(t);
  return a === 'autonome'
    ? '<span class="badge green">Autonome</span>'
    : '<span class="badge gold">Première fois à valider</span>';
}
function stopBanner(t) {
  if (!isStopped(t)) return '';
  return `<section class="strip red"><strong>Action arrêtée — en attente de ta décision</strong><p>${esc(t.stopReason || 'Une modification a été proposée : l’action ne reprend qu’après ta validation.')}</p><div class="actions">${btn('Valider la modification', `approveChange('${t.id}')`, 'good')}${btn('Refuser et reprendre l’ancienne version', `rejectChange('${t.id}')`, 'danger')}</div></section>`;
}
function approveChange(id) {
  let t = task(id);
  if (!t) return;
  t.stopped = false;
  t.stopReason = '';
  t.autonomy = 'autonome';
  t.status = 'En cours';
  (t.reviewHistory = t.reviewHistory || []).unshift({
    date: new Date().toISOString().slice(0, 10),
    finding: 'Modification validée par Walid.',
    decision: 'L’action repart et redevient autonome.',
  });
  save();
  render();
  notify('Modification validée, l’action repart.');
}
function rejectChange(id) {
  let t = task(id);
  if (!t) return;
  t.stopped = false;
  t.stopReason = '';
  t.status = 'En cours';
  (t.reviewHistory = t.reviewHistory || []).unshift({
    date: new Date().toISOString().slice(0, 10),
    finding: 'Modification refusée par Walid.',
    decision: 'L’ancienne version reprend.',
  });
  save();
  render();
  notify('Modification refusée, l’ancienne version reprend.');
}
function grantAutonomy(id) {
  let t = task(id);
  if (!t) return;
  t.autonomy = 'autonome';
  save();
  render();
  notify('Cette action tourne désormais seule.');
}
function revokeAutonomy(id) {
  let t = task(id);
  if (!t) return;
  t.autonomy = 'première fois à valider';
  save();
  render();
  notify('Autonomie retirée : l’action attendra ta validation.');
}
// proposition façon bras droit
function proposalCard(t) {
  if (t.proposalStatus !== 'pending')
    return '';
  let p = t.brief || {};
  return `<section class="strip wait"><strong>Ce que l’agent propose</strong>
 <div class="brief"><div><span>Ce que j’ai observé</span>${esc(p.observed || t.proposalReason || 'Observation non précisée.')}</div>
 <div><span>Ce que j’en déduis <em>(hypothèse)</em></span>${esc(p.hypothesis || 'À confirmer sur un volume plus large.')}</div>
 <div><span>Ce que je propose</span>${esc(p.proposal || t.goal)}</div>
 <div><span>Ce que ça change</span>${esc(p.effect || 'Effet attendu à mesurer au prochain tour.')}</div>
 <div><span>Si on ne fait rien</span>${esc(p.ifNothing || 'La situation reste en l’état.')}</div></div>
 <div class="actions">${btn('Valider l’action', `setTaskProposal('${t.id}',true)`, 'good')}${btn('Refuser', `setTaskProposal('${t.id}',false)`, 'danger')}</div></section>`;
}
// leçons : statut
const LESSON_STATES = ['à tester', 'confirmée', 'invalidée'];
function lessonState(m) {
  return m.state || 'à tester';
}
function setLessonState(taskId, idx, st) {
  let list = (data.memories || []).filter((m) => m.taskId === taskId);
  let m = list[idx];
  if (m) {
    m.state = st;
    save();
    render();
    notify('Leçon marquée « ' + st + ' ».');
  }
}

// Ce qui attend Walid dans le projet actif (doré). Sert à la barre du haut et aux pastilles du menu.
function waitingCounts(d = data) {
  let tasks = (d.tasks || []).filter((t) => t.proposalStatus !== 'rejected' && !t.done);
  return {
    planification: tasks.filter((t) => taskColor(t) === 'rouge').length,
    revision: tasks.filter((t) => stateIsAwaitingWalid(t)).length,
    resultats: (d.kpis || []).filter((k) => k.status === 'propose').length,
  };
}
function waitingSentence(n) {
  if (!n) return 'Rien ne t’attend dans ce projet';
  const mots = ['', 'Une chose', 'Deux choses', 'Trois choses', 'Quatre choses', 'Cinq choses'];
  return (mots[n] || n + ' choses') + (n > 1 ? ' t’attendent' : ' t’attend') + ' dans ce projet';
}
function navLink(slug, label, active, waits) {
  return `<a href="#${slug}" class="${active ? 'active' : ''}"${active ? ' aria-current="page"' : ''}>${label}${
    waits ? '<span class="wait-dot" title="Quelque chose t’attend ici" aria-label="(quelque chose t’attend)"></span>' : ''
  }</a>`;
}
function render() {
  if (!moneyData) moneyData = loadMoney();
  let hash = location.hash.slice(1);
  let isMoney = hash === moneyPage.slug;
  let idx = slugs.indexOf(hash);
  page = idx < 0 ? 0 : idx;
  let w = waitingCounts();
  let stepOn = (i) => !isMoney && slugs.includes(hash || 'planification') && i === page;
  document.getElementById('nav').innerHTML =
    `<div class="nav-group"><div class="nav-title">Cycle de travail</div>${pages
      .map((p, i) => navLink(slugs[i], p, stepOn(i), w[slugs[i]] > 0))
      .join('')}</div>` +
    `<div class="nav-group">${navLink('resultats', 'Résultats', hash === 'resultats', w.resultats > 0)}${navLink(
      'historique',
      'Historique',
      hash === 'historique',
      false,
    )}</div>` +
    `<div class="nav-group"><div class="nav-title">Hors projet</div>${navLink(moneyPage.slug, 'Argent — tous projets', isMoney, false)}</div>`;
  document.getElementById('breadcrumb').textContent = isMoney ? moneyPage.name : pages[page];
  document.getElementById('activeProject').textContent = projectDef.name;
  let total = w.planification + w.resultats;
  document.getElementById('activeDot').innerHTML = colorDot(total ? 'rouge' : projectColor(data));
  document.querySelector('.projectSelectWrap').hidden = isMoney;
  document.getElementById('waitSummary').textContent = waitingSentence(total);
  if (isMoney) {
    main.innerHTML = moneyPageHtml();
    return;
  }
  main.innerHTML =
    [planning, execution, verification, memory, priorities, revision][page]() +
    `<details style="margin-top:32px;border-top:1px solid var(--line);padding-top:18px"><summary style="cursor:pointer;color:var(--text-3)">Une remarque sur cette page ?</summary><p class="note">Tes remarques restent liées à cette étape.</p><textarea placeholder="Il manque… / Je voudrais voir…" oninput="note(this.value)">${esc(data.notes[page] || '')}</textarea><div class="actions">${btn('Télécharger mes remarques', 'downloadNotes()')}</div></details><div class="page-bottom">${page ? btn('← ' + pages[page - 1], `go(${page - 1})`) : '<span></span>'}${page < 5 ? btn(pages[page + 1] + ' →', `go(${page + 1})`) : btn('Retour à la planification ↻', 'go(0)')}</div>`;
}
function setCategory(f) {
  categoryFilter = f;
  render();
}
function setSource(f) {
  sourceFilter = f;
  render();
}
function downloadNotes() {
  let content = pages.map((p, i) => `## ${p}\n${data.notes[i] || ''}`).join('\n\n');
  download('remarques-loop-agent.md', content, 'text/markdown');
}
function download(name, content, type) {
  let a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
window.addEventListener('hashchange', () => {
  render();
  scrollTo(0, 0);
});
save();
render();
