// Onglet Frais évitables (demande de Walid du 11/11/2026) : tout ce qu'il paie alors qu'il ne
// devrait pas (agios, frais d'incident, rejets de prélèvement ou de virement, frais de saisie,
// pénalités d'impôts, frais d'avocat, frais de recouvrement du syndic…), combien ça coûte en
// tout, et la piste pour ne plus le payer ou le récupérer.
// - L'agent note chaque frais lu sur un relevé ou un avis (enregistrer_frais_evitable) ;
//   Walid peut aussi en ajouter un, changer son état (contesté, remboursé) ou le retirer.
// - Aucun IBAN ni numéro de compte : seulement l'organisme, le montant et la source.
// Chargé après documents.js : ajoute le lien et la page, comme historique.js.
'use strict';

const FEES_SLUG = 'frais';
const FEE_KINDS = ['Agios / intérêts débiteurs', 'Frais d’incident / commission d’intervention', 'Rejet de prélèvement ou de virement', 'Frais de saisie', 'Pénalités / majorations d’impôts', 'Frais d’avocat / commissaire de justice', 'Frais de recouvrement (syndic)', 'Cotisation carte / tenue de compte', 'Autre'];
const FEE_STATES = ['payé', 'à venir', 'contesté', 'remboursé'];
let feeStateFilter = 'Tous';
let feeKindFilter = 'Tous';

function feeList() {
  if (!Array.isArray(data.frais)) data.frais = [];
  return data.frais;
}
const feeSafeId = (id) => String(id || '').replace(/[^\w-]/g, '');
const feeById = (id) => feeList().find((f) => f.id === id);
const euros = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
function feeDate(f) {
  if (f.date) {
    const [y, m, d] = f.date.split('-');
    return `${d}/${m}/${y}`;
  }
  return f.period || '—';
}
// Même calcul que feeTotals (server/agent-tools.js) : « perdu » = payé moins ce qui a été rendu.
function feeTotalsUi(list) {
  const t = { paye: 0, a_venir: 0, conteste: 0, rembourse: 0 };
  for (const f of list) {
    const amount = Number(f.amount) || 0;
    const back = Math.min(Number(f.refunded) || 0, amount);
    if (f.state === 'à venir') t.a_venir += amount;
    else {
      t.paye += amount;
      t.rembourse += f.state === 'remboursé' ? amount : back;
      if (f.state === 'contesté') t.conteste += amount;
    }
  }
  t.perdu = t.paye - t.rembourse;
  return t;
}
function feeStateBadge(s) {
  const c = s === 'remboursé' ? 'green' : s === 'contesté' ? 'yellow' : s === 'à venir' ? 'gold' : 'red';
  return c;
}

function addFeeDialog() {
  const kinds = FEE_KINDS.map((k) => `<option>${esc(k)}</option>`).join('');
  const states = FEE_STATES.map((s) => `<option>${esc(s)}</option>`).join('');
  modal(
    'Ajouter un frais évitable',
    `<p class="note">Un frais que tu as payé (ou vas payer) alors que tu aurais pu l’éviter. Pas de numéro de compte.</p><label for="feeLabel">Libellé</label><input id="feeLabel" placeholder="ex. Commission d’intervention"><label for="feeKind">Catégorie</label><select id="feeKind">${kinds}</select><label for="feePayee">Organisme</label><input id="feePayee" placeholder="ex. banque, impôts, syndic"><div class="grid"><div><label for="feeDate">Date</label><input id="feeDate" type="date"></div><div><label for="feeAmount">Montant (€)</label><input id="feeAmount" type="number" step="0.01" min="0"></div></div><label for="feeState">État</label><select id="feeState">${states}</select><label for="feeSource">D’où vient le montant</label><input id="feeSource" placeholder="ex. relevé d’octobre 2026"><div class="actions">${btn('Ajouter', 'addFee()', 'good')}${btn('Annuler', 'closeDialog()')}</div>`,
  );
}
function addFee() {
  const val = (id) => String(document.getElementById(id).value || '').trim().slice(0, 160);
  const label = val('feeLabel');
  if (!label) return notify('Donne un libellé au frais.');
  const amount = Math.round(Number(val('feeAmount')) * 100) / 100;
  if (!(amount > 0)) return notify('Donne un montant positif.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(val('feeDate')) ? val('feeDate') : '';
  feeList().unshift({
    id: 'frais-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label,
    kind: FEE_KINDS.includes(val('feeKind')) ? val('feeKind') : 'Autre',
    payee: val('feePayee'),
    date,
    period: date ? '' : 'date à préciser',
    amount,
    state: FEE_STATES.includes(val('feeState')) ? val('feeState') : 'payé',
    source: val('feeSource'),
    addedAt: new Date().toISOString(),
    addedBy: 'walid',
  });
  closeDialog();
  save();
  render();
  notify('Frais ajouté.');
}
function setFeeState(id, value) {
  const f = feeById(id);
  if (!f || !FEE_STATES.includes(value)) return;
  f.state = value;
  f.updatedAt = new Date().toISOString();
  f.updatedBy = 'walid';
  save();
  render();
}
function setFeeRefund(id, value) {
  const f = feeById(id);
  if (!f) return;
  const n = Math.round(Number(value) * 100) / 100;
  f.refunded = n > 0 ? Math.min(n, Number(f.amount) || 0) : undefined;
  save();
  render();
}
function deleteFee(id) {
  const f = feeById(id);
  if (!f) return;
  if (!confirm(`Retirer « ${f.label} » (${euros(f.amount)}) de la liste ?`)) return;
  data.frais = feeList().filter((x) => x.id !== id);
  save();
  render();
  notify('Frais retiré.');
}
function setFeeStateFilter(f) {
  feeStateFilter = f;
  render();
}
function setFeeKindFilter(f) {
  feeKindFilter = f;
  render();
}

function feeRow(f) {
  const sid = feeSafeId(f.id);
  const states = FEE_STATES.map((s) => `<option${s === f.state ? ' selected' : ''}>${esc(s)}</option>`).join('');
  const sub = [f.payee, f.source ? 'Source : ' + f.source : ''].filter(Boolean).map(esc).join(' · ');
  const refund = f.state === 'remboursé' ? '<span class="tiny">tout</span>' : `<input type="number" step="0.01" min="0" value="${esc(f.refunded ?? '')}" placeholder="0" onchange="setFeeRefund('${sid}',this.value)" style="min-width:80px;max-width:100px">`;
  return `<tr>
<td><strong>${esc(f.label)}</strong>${sub ? `<div class="tiny">${sub}</div>` : ''}</td>
<td>${esc(f.kind)}</td>
<td>${esc(feeDate(f))}</td>
<td class="r" style="white-space:nowrap">${esc(euros(f.amount))}${f.estimate ? '<div class="tiny">estimation</div>' : ''}</td>
<td><span class="badge ${feeStateBadge(f.state)}" style="margin-bottom:4px">${esc(f.state)}</span><br><select onchange="setFeeState('${sid}',this.value)" style="min-width:110px">${states}</select></td>
<td>${refund}</td>
<td>${f.howToAvoid ? esc(f.howToAvoid) : '<span class="tiny">—</span>'}</td>
<td>${btn('✕', `deleteFee('${sid}')`)}</td>
</tr>`;
}

function feesPage() {
  const all = feeList();
  const t = feeTotalsUi(all);
  const byKind = {};
  for (const f of all) if (f.state !== 'à venir') byKind[f.kind] = (byKind[f.kind] || 0) + (Number(f.amount) || 0);
  const kindRows = Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(euros(v))}</td></tr>`)
    .join('');
  const shown = all.filter((f) => (feeStateFilter === 'Tous' || f.state === feeStateFilter) && (feeKindFilter === 'Tous' || f.kind === feeKindFilter));
  const stateFilters = ['Tous', ...FEE_STATES]
    .map((f) => btn(f === 'Tous' ? 'Tous' : f[0].toUpperCase() + f.slice(1), `setFeeStateFilter('${f}')`, feeStateFilter === f ? 'active' : ''))
    .join('');
  const kindOptions = ['Tous', ...FEE_KINDS]
    .map((k) => `<option value="${esc(k)}"${k === feeKindFilter ? ' selected' : ''}>${k === 'Tous' ? 'Toutes les catégories' : esc(k)}</option>`)
    .join('');
  const table = shown.length
    ? `<div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Frais</th><th>Catégorie</th><th>Date</th><th class="r">Montant</th><th>État</th><th>Récupéré (€)</th><th>Comment l’éviter ou le récupérer</th><th></th></tr></thead><tbody>${shown.map(feeRow).join('')}</tbody></table></div>`
    : `<div class="empty">${all.length ? 'Aucun frais pour ce filtre.' : 'Aucun frais évitable noté pour l’instant.'}</div>`;
  const box = (label, value, hint) => `<div class="metricbox"><span class="tiny">${label}</span><strong>${esc(euros(value))}</strong>${hint ? `<span class="tiny">${hint}</span>` : ''}</div>`;
  return `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(projectDef.name.toUpperCase())} / FRAIS ÉVITABLES</div><h1>Frais évitables</h1><p class="intro">Ce que tu paies alors que tu ne devrais pas : agios, frais d’incident, rejets de prélèvement ou de virement, frais de saisie, pénalités d’impôts, frais d’avocat ou de recouvrement… Pour chaque frais, la piste pour ne plus le payer ou le récupérer.</p></div></div>
<div class="metricgrid">${box('Payé', t.paye, `dont ${euros(t.rembourse)} récupéré`)}${box('Perdu pour de bon', t.perdu, t.conteste ? `${euros(t.conteste)} contesté en cours` : '')}${box('À venir', t.a_venir, 'annoncé, pas encore débité')}</div>
${kindRows ? `<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Par catégorie (payé)</h2><table class="mtbl"><tbody>${kindRows}</tbody></table></section>` : ''}
<div class="actions" style="margin-top:14px">${btn('+ Ajouter un frais', 'addFeeDialog()', 'good')}</div>
<div class="toolbar" style="margin-top:14px">${stateFilters}<select onchange="setFeeKindFilter(this.value)" style="width:auto">${kindOptions}</select></div>
${table}`;
}

// render : ajoute le lien Frais évitables (après Documents) et affiche sa page.
const baseRenderFees = render;
render = function () {
  const isFees = location.hash.slice(1) === FEES_SLUG;
  baseRenderFees();
  const nav = document.getElementById('nav');
  if (isFees) nav.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  nav.insertAdjacentHTML('beforeend', `<a href="#${FEES_SLUG}" class="${isFees ? 'active' : ''}"><span class="num">💸</span>Frais évitables</a>`);
  if (isFees) {
    document.getElementById('breadcrumb').textContent = 'Frais évitables';
    main.innerHTML = feesPage();
  }
};

render();
