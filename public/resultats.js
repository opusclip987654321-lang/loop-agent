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
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtNum = (v) => Number(v).toLocaleString('fr-FR');
// Une donnée absente reste visible comme absente : un tiret en italique, jamais 0.
const MISSING = '<span class="missing" title="Donnée indisponible : personne ne l’a relevée">—</span>';
const fmtV = (v, unit) => (v === null || v === undefined ? MISSING : `${fmtNum(v)}${unit ? ' ' + esc(unit) : ''}`);

// En-tête de colonne : « 28 sept. » pour une semaine (son lundi), sinon le libellé de la période.
function colLabel(key) {
  if (resultsGran !== 'semaine') return esc(Pz.label(key, resultsGran));
  const d = Pz.start(key, 'semaine');
  return `${d.getUTCDate()} ${MOIS_COURTS[d.getUTCMonth()]}`;
}

function periodTitle(key) {
  if (resultsGran !== 'semaine') return esc(Pz.label(key, resultsGran));
  return 'Semaine du ' + colLabel(key);
}
function shortDate(iso) {
  const d = Pz.start(Pz.periodKey(iso, 'mois'), 'mois');
  const day = Number(String(iso).slice(8, 10));
  return day ? `${day} ${MOIS_COURTS[d.getUTCMonth()]}` : esc(iso);
}

// Sens d'une évolution : « up » si ça va dans le bon sens, « down » si ça recule, « idle » sinon.
function trendInfo(k, cur, prev) {
  if (cur === null || prev === null) return { tone: 'idle', text: 'rien à comparer', missing: true };
  const d = Math.round((cur - prev) * 100) / 100;
  if (d === 0) return { tone: 'idle', text: '= stable' };
  const good = k.direction === 'reduire' ? d < 0 : d > 0;
  const arrow = d > 0 ? '▲' : '▼';
  const txt = prev !== 0 ? `${Math.abs(Math.round((d / Math.abs(prev)) * 100))} %` : `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}`;
  return { tone: good ? 'up' : 'down', text: `${arrow} ${txt}`, good };
}
// Ancienne signature, gardée pour qui l'appellerait encore.
function trend(k, cur, prev) {
  const t = trendInfo(k, cur, prev);
  return `<span class="c-${t.tone}">${esc(t.text)}</span>`;
}

// Petite courbe des périodes terminées. Les trous sont sautés, pas mis à zéro.
function sparkline(values, tone, label) {
  const pts = values.map((v, i) => (v === null ? null : [i, v])).filter(Boolean);
  if (pts.length < 2) return '<svg class="spark" width="62" height="20" aria-hidden="true"></svg>';
  const vs = pts.map((p) => p[1]);
  const min = Math.min(...vs),
    max = Math.max(...vs);
  const step = 48 / Math.max(1, values.length - 1);
  const xy = pts.map(([i, v]) => [2 + i * step, max === min ? 10 : 16 - ((v - min) / (max - min)) * 12]);
  const color = `var(--${tone})`;
  const last = xy[xy.length - 1];
  return `<svg class="spark" width="62" height="20" viewBox="0 0 62 20" role="img" aria-label="${esc(label)}"><polyline points="${xy
    .map((p) => p.map((n) => n.toFixed(1)).join(','))
    .join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></polyline><circle cx="${last[0].toFixed(
    1,
  )}" cy="${last[1].toFixed(1)}" r="2.4" fill="${color}"></circle></svg>`;
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

  const rows = valid.map((k) => {
    const cells = keys.map((p) => Pz.kpiValue(k, vals, p, resultsGran));
    const mine = vals.filter((v) => v.kpi === k.id);
    const last = mine.reduce((a, v) => (!a || String(v.date) + (v.at || '') > String(a.date) + (a.at || '') ? v : a), null) || {};
    const sub = `${k.agg === 'somme' ? 'total sur la période' : 'dernière valeur'}${
      last.date ? ' · relevé le ' + shortDate(last.date) + (last.source === 'walid' ? ' par toi' : ' par l’agent') : ''
    }`;
    const name = `<td class="kname"><span class="kn">${esc(k.name)}</span>${k.unit ? ` <span class="note">(${esc(k.unit)})</span>` : ''}<br><span class="note">${sub}</span> <button class="linkbtn" onclick="addKpiValue('${k.id}')">+ mesure</button></td>`;
    if (!mine.some((v) => !v.unavailable && typeof v.value === 'number') && cells.every((v) => v === null)) {
      return `<tr>${name}<td colspan="${keys.length}" class="never">Jamais mesuré — personne ne relève ce chiffre</td><td class="ktrend">${btn(
        'Relever ce chiffre',
        `addKpiValue('${k.id}')`,
        'wait-outline',
      )}</td></tr>`;
    }
    const t = trendInfo(k, cells[cells.length - 2], cells[cells.length - 3]);
    const label = `${k.name} : ${t.missing ? 'pas assez de chiffres pour comparer' : t.text.replace('▲', 'hausse de').replace('▼', 'baisse de')}`;
    return `<tr>${name}${cells
      .map((v, i) => `<td class="r${keys[i] === cur ? ' cur' : ''}">${fmtV(v)}</td>`)
      .join('')}<td class="ktrend"><div class="trendline">${sparkline(cells.slice(0, -1), t.tone, label)}<span class="c-${t.tone}${
      t.missing ? ' missing' : ''
    }">${esc(t.text)}</span></div></td></tr>`;
  });

  const table = valid.length
    ? `<div class="tablewrap results"><table><thead><tr><th>Indicateur</th>${keys
        .map((k) => `<th class="r${k === cur ? ' cur' : ''}">${colLabel(k)}${k === cur ? '<br><span class="sub">en cours</span>' : ''}</th>`)
        .join('')}<th>Tendance<br><span class="sub">${colLabel(done)} face à ${colLabel(before)}</span></th></tr></thead><tbody>${rows.join(
        '',
      )}</tbody></table></div><p class="note" style="margin-top:10px">La période en cours est encadrée : elle n’est pas finie, on ne la compare pas. Un tiret en italique veut dire « pas relevé », pas zéro.</p>`
    : '<div class="empty">Aucun indicateur clé validé pour ce projet. L’agent en proposera ; tu peux aussi en ajouter un.</div>';

  const proposals = proposed.length
    ? `<section class="strip wait"><strong>${proposed.length > 1 ? proposed.length + ' indicateurs proposés' : 'Un indicateur proposé'} par l’agent — à toi de trancher</strong>${proposed
        .map(
          (k) =>
            `<div class="kprop"><div><span class="kn">${esc(k.name)}</span>${k.unit ? ' (' + esc(k.unit) + ')' : ''} <span class="note">· ${
              k.agg === 'somme' ? 'total sur la période' : 'dernière valeur'
            } · ${k.direction === 'reduire' ? 'à réduire' : 'à augmenter'}</span><p class="note">${esc(k.why || '')}</p></div><div class="actions" style="margin:0">${btn(
              'Valider',
              `setKpiStatus('${k.id}','valide')`,
              'good',
            )}${btn('Refuser', `setKpiStatus('${k.id}','refuse')`, 'danger')}</div></div>`,
        )
        .join('')}</section>`
    : '';

  const bilans = (data.bilans || []).filter((b) => b.gran === resultsGran).sort((a, b) => b.period.localeCompare(a.period));
  const doneBilans = bilans.filter((b) => b.period === done);
  // Le titre d'un bilan est sa période : on ne lui prête pas un jugement qu'il n'a pas écrit.
  const bilanCard = (b) => {
    const dec = b.decisive
      ? `<p class="c-up" style="margin:11px 0 0;font-size:13px">▲ Ce qui a changé la donne : ${
          b.decisive.action && task(b.decisive.action)
            ? `<a href="javascript:void 0" onclick="detail('${esc(b.decisive.action)}')">${esc(b.decisive.title || task(b.decisive.action).title)}</a>`
            : esc(b.decisive.title || '')
        }${b.decisive.text ? ' — ' + esc(b.decisive.text) : ''}</p>`
      : '';
    return `<article class="card bilan"><div class="bhead"><span class="btitle">${periodTitle(b.period)}</span><span class="note">${
      b.by === 'walid' ? 'écrit par toi' : 'écrit par l’agent'
    }</span></div><p class="bwhy">${esc(b.why)}</p>${dec}</article>`;
  };
  const walidDone = doneBilans.some((b) => b.by === 'walid');
  const toWrite = valid.length && !walidDone
    ? `<article class="card bilan cwait"><div class="bhead"><span class="c-wait btitle">À toi d’écrire</span><span class="note">${periodTitle(done)}</span></div><p class="bwhy" style="margin-bottom:13px">${
        doneBilans.length ? 'L’agent a posé ses chiffres. Ton commentaire sur la période manque.' : 'Ni l’agent ni toi n’avez encore expliqué cette période.'
      }</p>${btn('Écrire mon bilan', `writeBilan('${done}')`, 'wait')}</article>`
    : '';
  const others = bilans.filter((b) => b.period !== done);

  return `<div class="heading"><div><h1>Résultats</h1><p class="intro">Les indicateurs clés de ${esc(
    projectDef.name,
  )}, période par période. Une donnée absente reste absente : elle ne vaut jamais zéro.</p></div><div class="actions">${btn(
    'Ajouter un indicateur',
    'newKpi()',
  )}</div></div><div class="toolbar" style="margin:0 0 26px">${Pz.GRANS.map((g) =>
    btn(GRAN_LABELS[g], `setResultsGran('${g}')`, g === resultsGran ? 'active' : ''),
  ).join('')}</div>${proposals}${table}<div class="heading" style="margin:36px 0 14px"><h2 style="margin:0">Pourquoi ça bouge</h2>${
    walidDone ? `<div class="actions" style="margin:0">${btn('Modifier mon bilan', `writeBilan('${done}')`)}</div>` : ''
  }</div>${
    doneBilans.length || toWrite
      ? `<div class="bilans">${doneBilans.map(bilanCard).join('')}${toWrite}</div>`
      : `<div class="empty">Pas encore de bilan pour ${periodTitle(done).toLowerCase()}.</div>`
  }${
    others.length
      ? `<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--text-3)">Bilans des autres périodes (${others.length})</summary><div class="bilans" style="margin-top:10px">${others
          .map(bilanCard)
          .join('')}</div></details>`
      : ''
  }`;
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
  if (isResults) {
    const nav = document.getElementById('nav');
    nav.querySelectorAll('a.active').forEach((a) => {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    });
    const me = nav.querySelector(`a[href="#${RESULTS_SLUG}"]`);
    if (me) {
      me.classList.add('active');
      me.setAttribute('aria-current', 'page');
    }
  }
  if (isResults) {
    document.getElementById('breadcrumb').textContent = 'Résultats';
    main.innerHTML = resultsPage();
  }
};

render();
