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

// Premier affichage avec les objectifs.
render();
