// Onglet « Résultats » d'un projet (document de travail §4, décidé le 07/11/2026).
// Par semaine, mois, trimestre, semestre et année :
// - les indicateurs clés du projet (pas la liste des tâches réussies) et leurs chiffres ;
// - pourquoi on a progressé (ou reculé) par rapport à la période précédente ;
// - l'action qui a changé la donne, s'il y en a une.
// Les agents proposent les indicateurs (Walid valide), les mesurent et écrivent les bilans.
// Donnée absente = « indisponible », jamais 0.
'use strict';

const RESULTS_SLUG = 'resultats';
const GRAN_LABELS = { semaine: 'Semaine', mois: 'Mois', trimestre: 'Trimestre', semestre: 'Semestre', annee: 'Année' };
let resultsGran = 'semaine';
try {
  resultsGran = localStorage.getItem('la-results-gran') || 'semaine';
} catch {}

const Pz = window.LAPeriodes;
const fmtV = (v, unit) =>
  v === null || v === undefined ? '<em class="note">indisponible</em>' : `${Number(v).toLocaleString('fr-FR')}${unit ? ' ' + esc(unit) : ''}`;

function trend(k, cur, prev) {
  if (cur === null || prev === null) return '<span class="note">—</span>';
  const d = Math.round((cur - prev) * 100) / 100;
  if (d === 0) return '<span class="note">= stable</span>';
  const good = k.direction === 'reduire' ? d < 0 : d > 0;
  const pct = prev !== 0 ? ` (${d > 0 ? '+' : ''}${Math.round((d / Math.abs(prev)) * 100)} %)` : '';
  return `<strong style="color:var(--${good ? 'green' : 'red'})">${d > 0 ? '▲ +' : '▼ '}${d.toLocaleString('fr-FR')}${pct}</strong>`;
}

function resultsPage() {
  const kpis = data.kpis || [];
  const vals = data.kpiValues || [];
  const keys = Pz.lastKeys(resultsGran, 6);
  const cur = keys[keys.length - 1];
  const done = keys[keys.length - 2];
  const before = keys[keys.length - 3];
  const valid = kpis.filter((k) => k.status === 'valide');
  const proposed = kpis.filter((k) => k.status === 'propose');

  const table = valid.length
    ? `<div class="tablewrap"><table><thead><tr><th>Indicateur</th>${keys
        .map((k) => `<th>${esc(Pz.label(k, resultsGran))}${k === cur ? '<br><span class="note">en cours</span>' : ''}</th>`)
        .join('')}<th>Évolution<br><span class="note">${esc(Pz.label(done, resultsGran))} vs précédente</span></th></tr></thead><tbody>${valid
        .map((k) => {
          const cells = keys.map((p) => Pz.kpiValue(k, vals, p, resultsGran));
          const last = (vals.find((v) => v.kpi === k.id) || {});
          return `<tr><td><strong>${esc(k.name)}</strong><br><span class="note">${k.agg === 'somme' ? 'total sur la période' : 'dernière valeur'}${
            last.date ? ' · mesuré le ' + esc(last.date) + (last.source === 'walid' ? ' (Walid)' : ' (agent)') : ''
          }</span><div class="actions" style="margin:4px 0 0">${btn('+ Mesure', `addKpiValue('${k.id}')`)}</div></td>${cells
            .map((v) => `<td>${fmtV(v, k.unit)}</td>`)
            .join('')}<td>${trend(k, cells[cells.length - 2], cells[cells.length - 3])}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : '<div class="empty">Aucun indicateur clé validé pour ce projet. L’agent en proposera ; tu peux aussi en ajouter un.</div>';

  const proposals = proposed.length
    ? `<section class="strip red"><strong>Indicateurs proposés par l’agent</strong>${proposed
        .map(
          (k) =>
            `<div style="margin-top:10px"><strong>${esc(k.name)}</strong>${k.unit ? ' (' + esc(k.unit) + ')' : ''} · ${
              k.agg === 'somme' ? 'total sur la période' : 'dernière valeur'
            } · ${k.direction === 'reduire' ? 'à réduire' : 'à augmenter'}<p class="note">${esc(k.why || '')}</p><div class="actions">${btn(
              '✅ Valider',
              `setKpiStatus('${k.id}','valide')`,
              'good',
            )}${btn('❌ Refuser', `setKpiStatus('${k.id}','refuse')`, 'danger')}</div></div>`,
        )
        .join('')}</section>`
    : '';

  const bilans = (data.bilans || []).filter((b) => b.gran === resultsGran).sort((a, b) => b.period.localeCompare(a.period));
  const bilanFor = (p) => bilans.filter((b) => b.period === p);
  const doneBilans = bilanFor(done);
  const bilanCard = (b) =>
    `<article class="card"><div class="toolbar" style="margin:0 0 8px"><span class="badge gold">${esc(Pz.label(b.period, b.gran))}</span><span class="badge">${
      b.by === 'walid' ? 'Écrit par Walid' : 'Écrit par l’agent'
    }</span></div><p style="white-space:pre-line">${esc(b.why)}</p>${
      b.decisive
        ? `<div class="strip"><strong>⭐ Action qui a changé la donne</strong><p>${
            b.decisive.action && task(b.decisive.action)
              ? `<a href="javascript:void 0" onclick="detail('${esc(b.decisive.action)}')">${esc(b.decisive.title || task(b.decisive.action).title)}</a>`
              : esc(b.decisive.title || '')
          }${b.decisive.text ? ' — ' + esc(b.decisive.text) : ''}</p></div>`
        : ''
    }</article>`;

  return `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(projectDef.name.toUpperCase())} / RÉSULTATS</div><h1>Résultats</h1><p class="intro">Les indicateurs clés du projet, période par période, et pourquoi ils bougent. Une donnée absente est « indisponible », jamais 0.</p></div><div class="actions">${btn(
    '+ Indicateur',
    'newKpi()',
  )}</div></div><div class="toolbar">${Pz.GRANS.map((g) => btn(GRAN_LABELS[g], `setResultsGran('${g}')`, g === resultsGran ? 'active' : '')).join('')}</div>${proposals}${table}<div class="heading" style="margin:26px 0 8px"><h2>Pourquoi ça bouge</h2><div class="actions" style="margin:0">${btn(
    'Écrire mon bilan',
    `writeBilan('${done}')`,
  )}</div></div>${
    doneBilans.length
      ? `<div class="grid">${doneBilans.map(bilanCard).join('')}</div>`
      : `<div class="empty">Pas encore de bilan pour ${esc(Pz.label(done, resultsGran))}${
          valid.length ? ' : l’agent l’écrira à son prochain tour.' : '.'
        }</div>`
  }${
    bilans.filter((b) => b.period !== done).length
      ? `<details style="margin-top:14px"><summary style="cursor:pointer">Bilans des autres périodes</summary><div class="grid" style="margin-top:10px">${bilans
          .filter((b) => b.period !== done)
          .map(bilanCard)
          .join('')}</div></details>`
      : ''
  }<p class="note" style="margin-top:14px">Comparaison : ${esc(Pz.label(done, resultsGran))} (terminée) face à ${esc(Pz.label(before, resultsGran))}.</p>`;
}

function setResultsGran(g) {
  resultsGran = g;
  try {
    localStorage.setItem('la-results-gran', g);
  } catch {}
  render();
}
function setKpiStatus(id, st) {
  const k = (data.kpis || []).find((x) => x.id === id);
  if (!k) return;
  k.status = st;
  k.decidedAt = new Date().toISOString();
  save();
  render();
  notify(st === 'valide' ? 'Indicateur validé : l’agent le mesurera.' : 'Indicateur refusé.');
}
function newKpi() {
  modal(
    'Nouvel indicateur clé',
    `<form id="kpiform"><label>Nom</label><input id="kpiname" required placeholder="Ex. Rendez-vous obtenus"><div class="grid"><div><label>Unité</label><input id="kpiunit" placeholder="Ex. rendez-vous, %, €"></div><div><label>Calcul sur la période</label><select id="kpiagg"><option value="somme">Total (on additionne : mails envoyés…)</option><option value="dernier">Dernière valeur (abonnés, taux…)</option></select></div><div><label>Un progrès, c’est</label><select id="kpidir"><option value="augmenter">Augmenter</option><option value="reduire">Réduire</option></select></div></div><div class="actions"><button class="primary">Ajouter</button>${btn('Annuler', 'closeDialog()')}</div></form>`,
  );
  document.getElementById('kpiform').onsubmit = (e) => {
    e.preventDefault();
    (data.kpis = data.kpis || []).push({
      id: 'kpi-' + Date.now().toString(36),
      name: document.getElementById('kpiname').value.trim(),
      unit: document.getElementById('kpiunit').value.trim(),
      agg: document.getElementById('kpiagg').value,
      direction: document.getElementById('kpidir').value,
      status: 'valide',
      by: 'walid',
      at: new Date().toISOString(),
    });
    save();
    closeDialog();
    render();
    notify('Indicateur ajouté : l’agent le mesurera.');
  };
}
function addKpiValue(id) {
  const k = (data.kpis || []).find((x) => x.id === id);
  if (!k) return;
  modal(
    'Mesure · ' + k.name,
    `<form id="kvform"><div class="grid"><div><label>Valeur${k.unit ? ' (' + esc(k.unit) + ')' : ''}</label><input id="kvval" type="number" step="any"></div><div><label>Jour mesuré</label><input id="kvdate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div></div><p class="note">${
      k.agg === 'somme' ? 'Ce qui s’est passé ce jour-là (pas un cumul).' : 'La valeur du moment.'
    }</p><label>D’où vient le chiffre ?</label><input id="kvfrom" placeholder="Ex. Gmail, envoyés"><div class="actions"><button class="primary">Enregistrer</button>${btn(
      'Donnée indisponible',
      `saveKpiValue('${k.id}',true)`,
    )}</div></form>`,
  );
  document.getElementById('kvform').onsubmit = (e) => {
    e.preventDefault();
    saveKpiValue(k.id, false);
  };
}
function saveKpiValue(id, unavailable) {
  const raw = document.getElementById('kvval').value;
  if (!unavailable && raw === '') return notify('Indique une valeur, ou choisis « Donnée indisponible ».');
  const v = {
    id: 'mes-' + Date.now().toString(36),
    kpi: id,
    date: document.getElementById('kvdate').value || new Date().toISOString().slice(0, 10),
    at: new Date().toISOString(),
    source: 'walid',
    origin: document.getElementById('kvfrom').value.trim() || undefined,
  };
  if (unavailable) v.unavailable = true;
  else v.value = Number(raw);
  (data.kpiValues = data.kpiValues || []).unshift(v);
  save();
  closeDialog();
  render();
  notify('Mesure enregistrée (saisie par Walid).');
}
function writeBilan(period) {
  const mine = (data.bilans || []).find((b) => b.gran === resultsGran && b.period === period && b.by === 'walid');
  const actions = (data.tasks || []).filter((t) => t.proposalStatus !== 'pending' && t.proposalStatus !== 'rejected');
  modal(
    'Mon bilan · ' + Pz.label(period, resultsGran),
    `<form id="bilanform"><label>Pourquoi ça a bougé (ou pas) par rapport à la période précédente ?</label><textarea id="bilanwhy" required style="min-height:140px">${esc(
      mine ? mine.why : '',
    )}</textarea><label>Action qui a changé la donne <span class="note">(facultatif)</span></label><select id="bilanact"><option value="">—</option>${actions
      .map((t) => `<option value="${esc(t.id)}" ${mine && mine.decisive && mine.decisive.action === t.id ? 'selected' : ''}>${esc(t.title)}</option>`)
      .join('')}</select><label>Ce qu’elle a changé</label><input id="bilantxt" value="${esc((mine && mine.decisive && mine.decisive.text) || '')}"><div class="actions"><button class="primary">Enregistrer</button>${btn(
      'Annuler',
      'closeDialog()',
    )}</div></form>`,
  );
  document.getElementById('bilanform').onsubmit = (e) => {
    e.preventDefault();
    const act = document.getElementById('bilanact').value;
    const t = act ? task(act) : null;
    const b = {
      id: 'bilan-' + Date.now().toString(36),
      gran: resultsGran,
      period,
      why: document.getElementById('bilanwhy').value.trim(),
      decisive: t ? { action: t.id, title: t.title, text: document.getElementById('bilantxt').value.trim() } : undefined,
      by: 'walid',
      at: new Date().toISOString(),
    };
    data.bilans = (data.bilans || []).filter((x) => !(x.gran === b.gran && x.period === period && x.by === 'walid'));
    data.bilans.unshift(b);
    save();
    closeDialog();
    render();
    notify('Bilan enregistré : l’agent le lira.');
  };
}

// render : ajoute le lien Résultats (avant Historique) et affiche sa page.
const baseRenderResults = render;
render = function () {
  const isResults = location.hash.slice(1) === RESULTS_SLUG;
  baseRenderResults();
  const nav = document.getElementById('nav');
  if (isResults) nav.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  const link = `<a href="#${RESULTS_SLUG}" class="${isResults ? 'active' : ''}"><span class="num">📈</span>Résultats</a>`;
  const hist = nav.querySelector('a[href="#historique"]');
  if (hist) hist.insertAdjacentHTML('beforebegin', link);
  else nav.insertAdjacentHTML('beforeend', link);
  if (isResults) {
    document.getElementById('breadcrumb').textContent = 'Résultats';
    main.innerHTML = resultsPage();
  }
};

render();
