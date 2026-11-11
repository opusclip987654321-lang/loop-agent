// Onglet Suivi des charges (demande de Walid du 11/11/2026) : pour chaque copropriété, mois par
// mois, ce que le syndic appelle, ce que Walid paie, les frais qu'on lui ajoute (relance, mise en
// demeure, avocat, commissaire de justice…) et les soldes que le syndic annonce. La page signale
// tout ce qui ne colle pas : soldes qui se contredisent, paiement non enregistré ou crédité pour
// un autre montant, frais sans justificatif, répétés ou en double, mois sans paiement.
// - L'agent note chaque ligne lue sur un document du syndic ou un relevé (enregistrer_charge) ;
//   Walid peut en ajouter une, changer l'état d'un frais ou d'un paiement, ou la retirer.
// - Calculs partagés avec le serveur : charges-calc.js (LACharges).
// - Aucun IBAN ni numéro de compte. Aucun montant dans le code : tout vit dans la base.
// Chargé après agenda.js : ajoute le lien et la page, comme historique.js.
'use strict';

const CHARGES_SLUG = 'charges';
const LCH = window.LACharges;
let chargesCopro = 'Toutes';
let chargesKind = 'Tous';

function chargesList() {
  if (!Array.isArray(data.charges)) data.charges = [];
  return data.charges;
}
const chSafeId = (id) => String(id || '').replace(/[^\w-]/g, '');
const chById = (id) => chargesList().find((l) => l.id === id);
const chWhen = (l) => LCH.frDate(l.date || l.month) || '—';
const chMonthLabel = (k) => {
  const m = /^(\d{4})-(\d{2})$/.exec(k);
  if (!m) return k;
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${MOIS[Number(m[2]) - 1]} ${m[1]}`;
};
function chargesVisible() {
  return (projectDef && projectDef.id === 'gestion-immo-banque') || chargesList().length > 0;
}

function addChargeDialog() {
  const opts = (list, sel) => list.map((k) => `<option${k === sel ? ' selected' : ''}>${esc(k)}</option>`).join('');
  const copros = [...new Set(chargesList().map((l) => l.copro))].map((c) => `<option value="${esc(c)}">`).join('');
  modal(
    'Ajouter une ligne au suivi des charges',
    `<p class="note">Un appel de fonds du syndic, un paiement, un frais ajouté ou un solde annoncé. Pas de numéro de compte.</p><label for="chCopro">Copropriété</label><input id="chCopro" list="chCopros" placeholder="ex. nom de la rue"><datalist id="chCopros">${copros}</datalist><label for="chKind">Type</label><select id="chKind">${opts(LCH.KINDS)}</select><label for="chLabel">Libellé</label><input id="chLabel" placeholder="ex. Appel T1, Frais de relance"><div class="grid"><div><label for="chDate">Date</label><input id="chDate" type="date"></div><div><label for="chAmount">Montant (€)</label><input id="chAmount" type="number" step="0.01"></div></div><label for="chRubric">Rubrique</label><select id="chRubric">${opts(LCH.RUBRICS, 'charges')}</select><label for="chFeeKind">Pour un frais : catégorie</label><select id="chFeeKind">${opts(LCH.FEE_KINDS)}</select><label for="chSource">D’où vient le montant</label><input id="chSource" placeholder="ex. situation de compte d’octobre 2026"><div class="actions">${btn('Ajouter', 'addCharge()', 'good')}${btn('Annuler', 'closeDialog()')}</div>`,
  );
}
function addCharge() {
  const val = (id) => String(document.getElementById(id).value || '').trim().slice(0, 160);
  const copro = val('chCopro').slice(0, 60);
  if (!copro) return notify('Donne le nom de la copropriété.');
  const kind = LCH.KINDS.includes(val('chKind')) ? val('chKind') : 'Appel de fonds';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(val('chDate')) ? val('chDate') : '';
  if (!date) return notify('Donne la date.');
  const amount = Math.round(Number(val('chAmount')) * 100) / 100;
  if (!Number.isFinite(amount) || (kind !== 'Solde annoncé' && !(amount > 0))) return notify('Donne un montant positif (un solde en ta faveur peut être négatif).');
  const l = {
    id: 'charge-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    copro,
    kind,
    label: val('chLabel'),
    rubric: LCH.RUBRICS.includes(val('chRubric')) ? val('chRubric') : 'charges',
    date,
    month: '',
    amount,
    source: val('chSource'),
    addedAt: new Date().toISOString(),
    addedBy: 'walid',
  };
  if (kind === 'Frais ajouté') {
    l.feeKind = LCH.FEE_KINDS.includes(val('chFeeKind')) ? val('chFeeKind') : 'Autre';
    l.state = 'à vérifier';
    l.proof = false;
  }
  if (kind === 'Paiement') l.recorded = 'à vérifier';
  chargesList().push(l);
  closeDialog();
  save();
  render();
  notify('Ligne ajoutée.');
}
function chTouch(l) {
  l.updatedAt = new Date().toISOString();
  l.updatedBy = 'walid';
  save();
  render();
}
function setChargeFeeState(id, v) {
  const l = chById(id);
  if (l && LCH.FEE_STATES.includes(v)) (l.state = v), chTouch(l);
}
function setChargeProof(id, v) {
  const l = chById(id);
  if (l) (l.proof = !!v), chTouch(l);
}
function setChargeRecorded(id, v) {
  const l = chById(id);
  if (l && LCH.RECORDED.includes(v)) (l.recorded = v), chTouch(l);
}
function deleteCharge(id) {
  const l = chById(id);
  if (!l) return;
  if (!confirm(`Retirer « ${l.label || l.kind} » (${LCH.eur(l.amount)}) du suivi ?`)) return;
  data.charges = chargesList().filter((x) => x.id !== id);
  save();
  render();
  notify('Ligne retirée.');
}
function setChargesCopro(c) {
  chargesCopro = c;
  render();
}
function setChargesKind(k) {
  chargesKind = k;
  render();
}

function chAlertsSection(alertes) {
  if (!alertes.length) return `<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Ce qui ne colle pas</h2><p class="tiny">Rien à signaler avec les lignes notées. Plus il y a de lignes (appels, paiements, soldes), plus la vérification est sûre.</p></section>`;
  const rows = alertes
    .map((a) => `<tr><td><span class="badge ${a.gravite === 'rouge' ? 'red' : 'yellow'}">${esc(a.type)}</span></td><td>${esc(a.copro)}</td><td>${esc(a.texte)}</td></tr>`)
    .join('');
  const rouges = alertes.filter((a) => a.gravite === 'rouge').length;
  return `<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Ce qui ne colle pas (${alertes.length}${rouges ? `, dont ${rouges} à faire expliquer` : ''})</h2><p class="tiny">À faire expliquer par le syndic, par écrit. Un frais sans justificatif ne se paie pas avant d’avoir la pièce.</p><div style="overflow-x:auto"><table class="mtbl"><tbody>${rows}</tbody></table></div></section>`;
}

function chCoproSection(c) {
  const t = c.totaux_eur;
  const box = (label, value, hint) => `<div class="metricbox"><span class="tiny">${label}</span><strong>${esc(LCH.eur(value))}</strong>${hint ? `<span class="tiny">${esc(hint)}</span>` : ''}</div>`;
  const soldes = Object.entries(c.soldes_annonces);
  const soldeBox = soldes.length
    ? soldes.map(([rub, s]) => box(`Dernier solde annoncé (${rub})`, s.montant, `au ${LCH.frDate(s.date)} · attendu aujourd’hui : ${LCH.eur(s.solde_attendu_aujourdhui)}`)).join('')
    : box('Solde annoncé', 0, 'aucun solde noté');
  const fe = c.frais_par_etat_eur;
  const feeHint = LCH.FEE_STATES.filter((s) => fe[s]).map((s) => `${s} ${LCH.eur(fe[s])}`).join(' · ');
  const rows = c.mois
    .slice()
    .reverse()
    .map((m) => {
      const soldes = m.soldes.map((s) => `${LCH.eur(s.montant)}${s.rubrique !== 'charges' ? ` <span class="tiny">${esc(s.rubrique)}</span>` : ''}`).join('<br>');
      const noPay = m.appele > 0 && !(m.paye > 0);
      return `<tr><td style="white-space:nowrap">${esc(chMonthLabel(m.mois))}</td><td class="r">${m.appele ? esc(LCH.eur(m.appele)) : '—'}</td><td class="r"${noPay ? ' style="color:var(--red,#c0392b)"' : ''}>${m.paye ? esc(LCH.eur(m.paye)) : noPay ? 'rien' : '—'}</td><td class="r"${m.frais ? ' style="color:var(--red,#c0392b);font-weight:600"' : ''}>${m.frais ? esc(LCH.eur(m.frais)) : '—'}</td><td class="r">${m.ecart ? esc((m.ecart > 0 ? '+' : '') + LCH.eur(m.ecart)) : '—'}</td><td class="r">${soldes || '—'}</td></tr>`;
    })
    .join('');
  return `<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">${esc(c.copro)}</h2>
<div class="metricgrid">${box('Appelé par le syndic', t.appele)}${box('Payé', t.paye, c.dernier_paiement ? `dernier paiement : ${LCH.frDate(c.dernier_paiement)}` : 'aucun paiement noté')}${box('Frais ajoutés', t.frais_ajoutes, feeHint)}${soldeBox}</div>
<div style="overflow-x:auto;margin-top:10px"><table class="mtbl"><thead><tr><th>Mois</th><th class="r">Appelé</th><th class="r">Payé</th><th class="r">Frais ajoutés</th><th class="r">Écart du mois</th><th class="r">Solde annoncé</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="tiny">Écart du mois = appelé + frais − payé − crédits. Un écart positif fait monter ce que tu dois.</p></section>`;
}

function chLineRow(l, flagged) {
  const sid = chSafeId(l.id);
  let etat = '';
  if (l.kind === 'Frais ajouté') {
    const st = l.state || 'à vérifier';
    const opts = LCH.FEE_STATES.map((s) => `<option${s === st ? ' selected' : ''}>${esc(s)}</option>`).join('');
    const c = st === 'justifié' ? 'green' : st === 'contesté' ? 'yellow' : st === 'payé' ? 'gold' : 'red';
    etat = `<span class="badge ${c}" style="margin-bottom:4px">${esc(st)}</span><br><select onchange="setChargeFeeState('${sid}',this.value)" style="min-width:110px">${opts}</select><div class="tiny"><label style="display:inline-flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" style="width:auto;min-width:0;margin:0"${l.proof === true ? ' checked' : ''} onchange="setChargeProof('${sid}',this.checked)"> justificatif reçu</label></div>`;
  } else if (l.kind === 'Paiement') {
    const r = l.recorded || 'à vérifier';
    const opts = LCH.RECORDED.map((s) => `<option${s === r ? ' selected' : ''}>${esc(s)}</option>`).join('');
    etat = `<span class="tiny">Crédité par le syndic :</span><br><select onchange="setChargeRecorded('${sid}',this.value)" style="min-width:110px">${opts}</select>${l.recordedAmount ? `<div class="tiny">crédité : ${esc(LCH.eur(l.recordedAmount))}</div>` : ''}`;
  }
  const sub = [l.feeKind, l.rubric && l.rubric !== 'charges' ? l.rubric : '', l.bank, l.note, l.source ? 'Source : ' + l.source : ''].filter(Boolean).map(esc).join(' · ');
  return `<tr${flagged ? ' style="background:rgba(192,57,43,.06)"' : ''}><td style="white-space:nowrap">${esc(chWhen(l))}</td><td>${esc(l.copro)}</td><td>${esc(l.kind)}</td><td><strong>${esc(l.label || '—')}</strong>${sub ? `<div class="tiny">${sub}</div>` : ''}</td><td class="r" style="white-space:nowrap">${esc(LCH.eur(l.amount))}${l.estimate ? '<div class="tiny">estimation</div>' : ''}</td><td>${etat}</td><td>${btn('✕', `deleteCharge('${sid}')`)}</td></tr>`;
}

function chargesPage() {
  const all = chargesList();
  const a = LCH.analyse(all);
  const head = `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(projectDef.name.toUpperCase())} / SUIVI DES CHARGES</div><h1>Suivi des charges</h1><p class="intro">Pour chaque copropriété, mois par mois : ce que le syndic appelle, ce que tu paies, les frais qu’on t’ajoute (relance, mise en demeure, avocat, commissaire de justice…) et les soldes qu’il annonce. La page vérifie que tout est cohérent et signale chaque frais sans justificatif.</p></div></div>
<div class="actions">${btn('+ Ajouter une ligne', 'addChargeDialog()', 'good')}</div>`;
  if (!all.length) return `${head}<div class="empty">Aucune ligne pour l’instant : appels de fonds, paiements, frais et soldes seront notés ici.</div>`;
  const names = a.copros.map((c) => c.copro);
  if (chargesCopro !== 'Toutes' && !names.includes(chargesCopro)) chargesCopro = 'Toutes';
  const keep = (c) => chargesCopro === 'Toutes' || c === chargesCopro;
  const coproBtns = ['Toutes', ...names].map((c) => btn(esc(c), `setChargesCopro(${esc(JSON.stringify(c))})`, chargesCopro === c ? 'active' : '')).join('');
  const flagged = new Set(a.alertes.flatMap((x) => x.ids));
  const lines = all
    .filter((l) => keep(l.copro) && (chargesKind === 'Tous' || l.kind === chargesKind))
    .sort((x, y) => LCH.sortKey(y).localeCompare(LCH.sortKey(x)));
  const kindOptions = ['Tous', ...LCH.KINDS].map((k) => `<option value="${esc(k)}"${k === chargesKind ? ' selected' : ''}>${k === 'Tous' ? 'Tous les types' : esc(k)}</option>`).join('');
  const table = lines.length
    ? `<div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Date</th><th>Copro</th><th>Type</th><th>Libellé</th><th class="r">Montant</th><th>État</th><th></th></tr></thead><tbody>${lines.map((l) => chLineRow(l, flagged.has(l.id))).join('')}</tbody></table></div>`
    : '<div class="empty">Aucune ligne pour ce filtre.</div>';
  return `${head}<div class="toolbar" style="margin-top:14px">${coproBtns}</div>
${chAlertsSection(a.alertes.filter((x) => keep(x.copro)))}
${a.copros.filter((c) => keep(c.copro)).map(chCoproSection).join('')}
<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Toutes les lignes</h2><div class="toolbar"><select onchange="setChargesKind(this.value)" style="width:auto">${kindOptions}</select></div>${table}</section>`;
}

// render : ajoute le lien Suivi des charges (après Agenda) et affiche sa page.
const baseRenderCharges = render;
render = function () {
  const isCharges = location.hash.slice(1) === CHARGES_SLUG;
  baseRenderCharges();
  if (!chargesVisible()) return;
  const nav = document.getElementById('nav');
  if (isCharges) nav.querySelectorAll('a.active').forEach((x) => x.classList.remove('active'));
  nav.insertAdjacentHTML('beforeend', `<a href="#${CHARGES_SLUG}" class="${isCharges ? 'active' : ''}"><span class="num">🏢</span>Suivi des charges</a>`);
  if (isCharges) {
    document.getElementById('breadcrumb').textContent = 'Suivi des charges';
    main.innerHTML = chargesPage();
  }
};

render();
