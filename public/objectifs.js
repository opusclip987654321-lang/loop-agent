// Objectifs et résultats mesurés (document de travail §2, décidé le 07/11/2026).
// Chargé après historique.js : remplace la validation d'une action et ajoute
// l'objectif et les résultats sur les cartes et dans le détail d'une action.
//
// Règles :
// - Walid fixe l'objectif ; l'agent le suggère dans sa proposition.
// - Trois types : chiffré (cible), fait / pas fait, à observer (seuil obligatoire :
//   un volume ou une durée qui déclenche le jugement).
// - L'agent mesure ; Walid peut aussi saisir. Chaque valeur dit sa source.
// - Donnée absente = « indisponible », jamais 0.
'use strict';

const OBJ_LABELS = { chiffre: 'Chiffré', fait_pas_fait: 'Fait / pas fait', a_observer: 'À observer' };
const fmtN = (n) => (typeof n === 'number' ? n.toLocaleString('fr-FR') : '—');

function objectiveText(o) {
  if (!o) return '';
  if (o.kind === 'chiffre')
    return `${o.direction === 'reduire' ? 'Réduire à' : 'Atteindre'} ${fmtN(o.target)}${o.unit ? ' ' + esc(o.unit) : ''}`;
  if (o.kind === 'fait_pas_fait') return 'sans cible chiffrée';
  const th = o.threshold || {};
  return th.type === 'duree'
    ? `juger après ${fmtN(th.value)} jours`
    : `juger après ${fmtN(th.value)} ${esc(th.unit || '')}`;
}

// Où en est l'action, en une phrase. Ne remplace jamais une donnée absente par 0.
function objectiveProgress(t) {
  const o = t.objective;
  if (!o) return '';
  const res = (t.results || []).filter((r) => !r.unavailable);
  if (o.kind === 'chiffre') {
    const last = res.find((r) => typeof r.value === 'number');
    if (!last) return 'Dernier résultat : indisponible';
    const gap = o.direction === 'reduire' ? o.target - last.value : last.value - o.target;
    return `Dernier résultat : ${fmtN(last.value)} → ${gap >= 0 ? 'objectif atteint' : 'il manque ' + fmtN(Math.round(-gap * 100) / 100)}`;
  }
  if (o.kind === 'fait_pas_fait') return res.some((r) => r.done === true) ? 'Fait ✓' : 'Pas encore fait';
  const th = o.threshold || {};
  if (th.type === 'duree') {
    const from = Date.parse(t.decidedAt || t.proposedAt || '');
    const days = from ? Math.floor((Date.now() - from) / 86400000) : 0;
    return days >= th.value ? `Seuil atteint (${days} j) : à juger` : `${days} / ${fmtN(th.value)} jours`;
  }
  const total = res.reduce((a, r) => a + (typeof r.volume === 'number' ? r.volume : 0), 0);
  return total >= th.value
    ? `Seuil atteint (${fmtN(total)} ${esc(th.unit || '')}) : à juger`
    : `${fmtN(total)} / ${fmtN(th.value)} ${esc(th.unit || '')}`;
}

function objectiveStrip(t) {
  const o = t.objective;
  if (t.proposalStatus === 'rejected' || t.done) return '';
  if (!o)
    return t.proposalStatus === 'pending'
      ? ''
      : `<div class="strip"><strong>🎯 Objectif à fixer</strong><p class="note">Sans objectif, l’agent ne peut pas juger cette action.</p><div class="actions">${btn('Fixer l’objectif', `editObjective('${t.id}')`)}</div></div>`;
  const pending = o.setBy !== 'walid';
  return `<div class="strip${pending ? ' red' : ''}"><strong>🎯 ${esc(OBJ_LABELS[o.kind] || '')}</strong> · ${objectiveText(o)}${
    pending ? ' <span class="note">(suggéré par l’agent)</span>' : ''
  }<p class="note">${objectiveProgress(t)}</p>${
    t.proposalStatus === 'pending' ? '' : `<div class="actions">${btn('Modifier l’objectif', `editObjective('${t.id}')`)}</div>`
  }</div>`;
}

// Carte d'action : l'objectif s'ajoute sous la proposition.
const baseProposalCardObj = proposalCard;
proposalCard = function (t) {
  return baseProposalCardObj(t) + objectiveStrip(t);
};

// Valider une proposition : d'abord fixer (ou confirmer) l'objectif.
const baseSetTaskProposalObj = setTaskProposal;
setTaskProposal = function (id, approved) {
  if (!approved) return baseSetTaskProposalObj(id, false);
  editObjective(id, true);
};

function editObjective(id, approving = false) {
  const t = task(id);
  if (!t) return;
  const o = t.objective || { kind: 'chiffre', direction: 'augmenter' };
  const th = o.threshold || { type: 'volume' };
  const sel = (a, b) => (a === b ? 'selected' : '');
  modal(
    approving ? 'Valider l’action et fixer son objectif' : 'Objectif de l’action',
    `<p><strong>${esc(t.title)}</strong></p>${t.goal ? `<p class="note">${esc(t.goal)}</p>` : ''}${
      t.objective && t.objective.setBy !== 'walid' ? '<p class="note">Pré-rempli avec la suggestion de l’agent : corrige si besoin.</p>' : ''
    }<form id="objform"><label>Comment juger cette action ?</label><select id="objkind" onchange="objKindChanged()">
<option value="chiffre" ${sel(o.kind, 'chiffre')}>Chiffré — une cible existe</option>
<option value="fait_pas_fait" ${sel(o.kind, 'fait_pas_fait')}>Fait / pas fait</option>
<option value="a_observer" ${sel(o.kind, 'a_observer')}>À observer — pas encore de cible, mais un seuil pour juger</option></select>
<div id="obj-chiffre" class="grid"><div><label>Cible</label><input id="objtarget" type="number" step="any" value="${esc(o.target ?? '')}"></div><div><label>Unité</label><input id="objunit" value="${esc(o.unit || '')}" placeholder="Ex. rendez-vous / semaine"></div><div><label>Sens</label><select id="objdir"><option value="augmenter" ${sel(o.direction, 'augmenter')}>Augmenter</option><option value="reduire" ${sel(o.direction, 'reduire')}>Réduire</option></select></div></div>
<div id="obj-observer"><div class="grid"><div><label>Juger après</label><input id="objthval" type="number" min="1" value="${esc(th.value ?? '')}"></div><div><label>Seuil en</label><select id="objthtype" onchange="objKindChanged()"><option value="volume" ${sel(th.type, 'volume')}>Volume</option><option value="duree" ${sel(th.type, 'duree')}>Jours</option></select></div><div id="obj-thunit"><label>De quoi ?</label><input id="objthunit" value="${esc(th.unit || '')}" placeholder="Ex. mails envoyés dans le secteur"></div></div><p class="note">Exemple : 200 mails envoyés dans un même secteur avant de juger.</p></div>
<div class="actions"><button class="primary">${approving ? '✅ Valider l’action' : 'Enregistrer'}</button>${btn('Annuler', 'closeDialog()')}</div></form>`,
  );
  objKindChanged();
  document.getElementById('objform').onsubmit = (e) => {
    e.preventDefault();
    const kind = document.getElementById('objkind').value;
    const next = { kind, setBy: 'walid', setAt: new Date().toISOString() };
    if (kind === 'chiffre') {
      const target = document.getElementById('objtarget').value;
      if (target === '') return notify('Indique la cible.');
      next.target = Number(target);
      next.unit = document.getElementById('objunit').value.trim();
      next.direction = document.getElementById('objdir').value;
    }
    if (kind === 'a_observer') {
      const v = Number(document.getElementById('objthval').value);
      const type = document.getElementById('objthtype').value;
      const unit = document.getElementById('objthunit').value.trim();
      if (!(v > 0)) return notify('Le seuil est obligatoire : un volume ou un nombre de jours.');
      if (type === 'volume' && !unit) return notify('Précise de quoi est fait le volume (ex. mails envoyés).');
      next.threshold = { type, value: v, unit: type === 'volume' ? unit : 'jours' };
    }
    t.objective = next;
    t.results = t.results || [];
    if (approving) {
      closeDialog();
      baseSetTaskProposalObj(id, true);
      notify('Action validée avec son objectif : l’agent mesurera le résultat.');
      return;
    }
    save();
    closeDialog();
    render();
    notify('Objectif enregistré : l’agent le lira au prochain tour.');
  };
}
function objKindChanged() {
  const kind = document.getElementById('objkind')?.value;
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  };
  show('obj-chiffre', kind === 'chiffre');
  show('obj-observer', kind === 'a_observer');
  show('obj-thunit', document.getElementById('objthtype')?.value !== 'duree');
}

// ---------- Résultats dans le détail d'une action ----------
function resultsPanel(t) {
  const list = t.results || [];
  const rows = list
    .slice(0, 12)
    .map(
      (r) =>
        `<tr><td>${esc(r.date || '')}${r.period ? `<br><span class="note">${esc(r.period)}</span>` : ''}</td><td>${
          r.unavailable
            ? '<em>indisponible</em>'
            : [
                typeof r.value === 'number' ? '<strong>' + fmtN(r.value) + '</strong>' : '',
                r.done === true ? 'fait' : r.done === false ? 'pas fait' : '',
                typeof r.volume === 'number' ? '+' + fmtN(r.volume) : '',
              ]
                .filter(Boolean)
                .join(' · ')
        }</td><td>${r.source === 'walid' ? 'Saisi par Walid' : 'Relevé par l’agent'}${r.origin ? `<br><span class="note">${esc(r.origin)}</span>` : ''}</td><td>${esc(r.note || '')}</td></tr>`,
    )
    .join('');
  return `<section class="card space"><div class="heading" style="margin:0 0 8px"><h3>🎯 Objectif et résultats</h3><div class="actions" style="margin:0">${btn(
    t.objective ? 'Modifier l’objectif' : 'Fixer l’objectif',
    `editObjective('${t.id}')`,
  )}</div></div>${
    t.objective ? `<p><strong>${esc(OBJ_LABELS[t.objective.kind])}</strong> · ${objectiveText(t.objective)}</p><p class="note">${objectiveProgress(t)}</p>` : '<p class="note">Aucun objectif fixé.</p>'
  }${
    rows
      ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Mesure</th><th>Source</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="note">Aucun résultat mesuré pour l’instant.</p>'
  }<details style="margin-top:10px"><summary style="cursor:pointer">+ Saisir un résultat moi-même</summary><div class="grid"><div><label>Valeur</label><input id="resval-${t.id}" type="number" step="any"></div><div><label>Volume ajouté</label><input id="resvol-${t.id}" type="number" step="any"></div><div><label>Fait ?</label><select id="resdone-${t.id}"><option value="">—</option><option value="1">Fait</option><option value="0">Pas fait</option></select></div><div><label>Période</label><input id="resper-${t.id}" placeholder="Ex. semaine du 03/11"></div></div><label>D’où vient le chiffre ?</label><input id="resfrom-${t.id}" placeholder="Ex. YouTube Studio, 28 derniers jours"><label>Note</label><input id="resnote-${t.id}"><div class="actions">${btn(
    'Enregistrer le résultat',
    `addWalidResult('${t.id}')`,
    'primary',
  )}${btn('Donnée indisponible', `addWalidResult('${t.id}',true)`)}</div></details></section>`;
}
function addWalidResult(id, unavailable = false) {
  const t = task(id);
  if (!t) return;
  const val = (k) => (document.getElementById(k + '-' + id)?.value || '').trim();
  const r = {
    id: 'res-' + Date.now().toString(36),
    date: new Date().toISOString().slice(0, 10),
    at: new Date().toISOString(),
    source: 'walid',
    origin: val('resfrom') || undefined,
    period: val('resper') || undefined,
    note: val('resnote') || undefined,
  };
  if (unavailable) r.unavailable = true;
  else {
    if (val('resval') !== '') r.value = Number(val('resval'));
    if (val('resvol') !== '') r.volume = Number(val('resvol'));
    if (val('resdone') !== '') r.done = val('resdone') === '1';
    if (r.value === undefined && r.volume === undefined && r.done === undefined)
      return notify('Indique une valeur, un volume ou « fait » — ou choisis « Donnée indisponible ».');
  }
  (t.results = t.results || []).unshift(r);
  save();
  detail(id);
  render();
  notify('Résultat enregistré (saisi par Walid).');
}

const baseDetailObj = detail;
detail = function (id, showTools = false) {
  baseDetailObj(id, showTools);
  const t = task(id);
  const layout = document.querySelector('#dialogbody .task-detail-layout');
  if (t && layout && t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected')
    layout.insertAdjacentHTML('afterend', resultsPanel(t));
};


// ---------- Copier une action dans d'autres projets (§6, décidé le 07/11/2026) ----------
// Copies indépendantes : chaque projet a la sienne et elles évoluent séparément.
function copyActionDialog(id) {
  const t = task(id);
  if (!t) return;
  const others = projects.filter((p) => p.id !== projectId);
  modal(
    'Copier l’action dans d’autres projets',
    `<p><strong>${esc(t.title)}</strong></p><p class="note">Chaque projet reçoit sa propre copie, validée, avec le même objectif. Elles évoluent ensuite séparément ; les résultats et l’historique ne sont pas copiés.</p><div style="display:grid;gap:6px;margin:12px 0">${others
      .map(
        (p) =>
          `<label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" name="copyto" value="${esc(p.id)}"> ${esc(p.name)}${p.paused ? ' <span class="note">(en pause)</span>' : ''}</label>`,
      )
      .join('')}</div><div class="actions">${btn('Copier', `confirmCopyAction('${t.id}')`, 'primary')}${btn('Annuler', 'closeDialog()')}</div>`,
  );
}
function confirmCopyAction(id) {
  const t = task(id);
  if (!t) return;
  const targets = [...document.querySelectorAll('input[name=copyto]:checked')].map((x) => x.value);
  if (!targets.length) return notify('Coche au moins un projet.');
  const now = new Date().toISOString();
  for (const pid of targets) {
    const doc = loadProject(pid);
    const nid = 'copie-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const c = JSON.parse(JSON.stringify(t));
    Object.assign(c, {
      id: nid,
      origin: 'Walid',
      permanent: false,
      proposalStatus: 'approved',
      decidedAt: now,
      status: 'À planifier',
      stopped: false,
      stopReason: '',
      done: false,
      doneAt: undefined,
      results: [],
      reviewHistory: [],
      reviewConversation: [],
      lastAgentTurn: undefined,
      copiedFrom: { project: projectId, action: t.id, at: now },
    });
    if (c.objective) c.objective = { ...c.objective, setBy: 'walid', setAt: now };
    c.ideas = (c.ideas || []).map((i, n) =>
      typeof i === 'string'
        ? i
        : { ...i, id: nid + '-idea-' + n, latestStage: 'Planification', stageHistory: [], agentComment: '', errorState: undefined },
    );
    doc.tasks.push(c);
    doc.priorities = doc.priorities || [];
    doc.priorities.push(nid);
    LA.set(projectKey(pid), JSON.stringify(doc));
  }
  closeDialog();
  render();
  notify('Action copiée dans ' + targets.length + ' projet(s).');
}
const baseDetailCopy = detail;
detail = function (id, showTools = false) {
  baseDetailCopy(id, showTools);
  const t = task(id);
  if (!t || t.proposalStatus === 'pending' || t.proposalStatus === 'rejected') return;
  const box = document.querySelector('#dialogbody .toolbar');
  if (box) box.insertAdjacentHTML('beforeend', btn('⧉ Copier dans d’autres projets', `copyActionDialog('${t.id}')`));
};

// ---------- Premier résultat à valider (choix A de Walid, 07/11/2026) ----------
// Une action « première fois à valider » (par exemple créée par Walid) tourne une
// première fois ; l'agent attend ensuite que Walid valide ce premier résultat.
function firstRunStrip(t) {
  if (!t.firstRunPending) return '';
  const last = (t.reviewHistory || []).find((h) => h.by === 'agent') || {};
  return `<section class="strip red"><strong>🔎 Premier résultat à valider</strong>${
    last.aiObservation ? `<p><span class="note">Ce que l’agent a fait :</span> ${esc(last.aiObservation)}</p>` : ''
  }${last.aiDecision ? `<p><span class="note">Ce qu’il en conclut :</span> ${esc(last.aiDecision)}</p>` : ''}${
    last.plan ? `<p><span class="note">La suite qu’il propose :</span> ${esc(last.plan)}</p>` : ''
  }<p class="note">L’action attend ta réponse avant de continuer.</p><div class="actions">${btn(
    '✅ Valider : elle tourne seule',
    `validateFirstRun('${t.id}')`,
    'good',
  )}${btn('✏️ Refaire avec mes remarques', `redoFirstRun('${t.id}')`)}</div></section>`;
}
function validateFirstRun(id) {
  const t = task(id);
  if (!t) return;
  t.firstRunPending = false;
  t.autonomy = 'autonome';
  t.firstRunValidatedAt = new Date().toISOString();
  save();
  render();
  notify('Premier résultat validé : l’action tourne désormais seule.');
}
function redoFirstRun(id) {
  const t = task(id);
  if (!t) return;
  modal(
    'Refaire le premier tour',
    `<p><strong>${esc(t.title)}</strong></p><label for="redoMsg">Ce que l’agent doit changer</label><textarea id="redoMsg" placeholder="Ex. : commence par me proposer 3 identités possibles avant les visuels…"></textarea><p class="note">L’agent lira ta remarque, refera un premier tour et te le montrera à nouveau.</p><div class="actions">${btn(
      'Envoyer',
      `confirmRedoFirstRun('${t.id}')`,
      'primary',
    )}${btn('Annuler', 'closeDialog()')}</div>`,
  );
}
function confirmRedoFirstRun(id) {
  const t = task(id);
  const msg = (document.getElementById('redoMsg')?.value || '').trim();
  if (!msg) return notify('Écris ce que l’agent doit changer.');
  (t.reviewConversation = t.reviewConversation || []).push({ role: 'Walid', date: new Date().toISOString().slice(0, 10), text: msg, correctionType: 'Premier tour à refaire' });
  t.firstRunPending = false;
  save();
  closeDialog();
  render();
  notify('Remarque envoyée : l’agent refera un premier tour.');
}
const baseProposalCardFirst = proposalCard;
proposalCard = function (t) {
  return firstRunStrip(t) + baseProposalCardFirst(t);
};
const baseTaskColorFirst = taskColor;
taskColor = function (t) {
  if (t.firstRunPending && t.status !== 'En pause') return 'rouge';
  return baseTaskColorFirst(t);
};

// Demandes à Walid (règle du 09/11/2026) : ce dont l'agent a besoin reste affiché, et l'action
// rouge, jusqu'à ce que Walid ferme la demande lui-même. Valider l'action ne la ferme pas.
function demandesOuvertes(t) {
  return (t.demandes || []).filter((d) => d.statut === 'ouverte');
}
function demandesStrip(t) {
  const ds = demandesOuvertes(t);
  if (!ds.length) return '';
  const rows = ds
    .map(
      (d) =>
        `<div style="margin-top:10px"><strong>${esc(d.texte)}</strong>${d.pourquoi ? `<p class="tiny" style="margin:4px 0 0">${esc(d.pourquoi)}</p>` : ''}<p class="tiny" style="margin:4px 0 6px">Demandé le ${esc(String(d.at).slice(0, 10).split('-').reverse().join('/'))}${d.source === 'compte rendu' ? ' · repéré dans un compte rendu de l’agent' : ''}</p><input id="dem-${d.id}" placeholder="Ta réponse (facultatif), par exemple « couverture A »" style="width:100%;margin-bottom:6px"><div class="actions" style="margin-top:0">${btn('C’est fait', `fermerDemande('${t.id}','${d.id}','faite')`, 'good')}${btn('Plus besoin', `fermerDemande('${t.id}','${d.id}','abandonnee')`)}</div></div>`,
    )
    .join('');
  return `<section class="strip red" style="margin:12px 0"><strong>🙋 ${ds.length > 1 ? ds.length + ' choses attendent' : 'Une chose attend'} ton aide</strong>${rows}</section>`;
}
function fermerDemande(taskId, demId, statut) {
  const t = task(taskId);
  const d = t && (t.demandes || []).find((x) => x.id === demId);
  if (!d) return;
  const input = document.getElementById('dem-' + demId);
  const reponse = input && input.value.trim();
  d.statut = statut;
  d.fermeeLe = new Date().toISOString();
  if (reponse) d.reponse = reponse.slice(0, 500);
  save();
  render();
  notify(statut === 'faite' ? 'Demande fermée : l’agent le verra à son prochain passage.' : 'Demande retirée.');
}
const baseProposalCardDem = proposalCard;
proposalCard = function (t) {
  return demandesStrip(t) + baseProposalCardDem(t);
};
const baseIdeaAccessRowsDem = ideaAccessRows;
ideaAccessRows = function (t) {
  return demandesStrip(t) + baseIdeaAccessRowsDem(t);
};
const baseTaskColorDem = taskColor;
taskColor = function (t) {
  if (t.status !== 'En pause' && demandesOuvertes(t).length) return 'rouge';
  return baseTaskColorDem(t);
};

// Premier affichage avec les objectifs.
render();
