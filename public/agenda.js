// Onglet Agenda (demande de Walid du 11/11/2026) : quand l'argent doit être sur le compte avant
// chaque prélèvement habituel (box, téléphone, énergie, crédits, assurance…), les virements à
// faire à la main (syndics), les entrées d'argent repères, et les dates à ne pas rater
// (assemblées générales de copropriété…), avec une date sûre ou supposée.
// - L'agent note chaque ligne lue sur un relevé, un avis ou un mail (enregistrer_agenda) ;
//   Walid peut en ajouter une, changer son état ou la retirer.
// - Aucun IBAN ni numéro de compte : seulement le nom de la banque, le jour et le montant.
// Chargé après frais.js : ajoute le lien et la page, comme historique.js.
'use strict';

const AGENDA_SLUG = 'agenda';
const AGENDA_KINDS_UI = ['Prélèvement', 'Virement à faire', 'Entrée d’argent', 'Assemblée générale', 'Échéance / rendez-vous', 'Autre'];
const AGENDA_STATES_UI = ['actif', 'à confirmer', 'arrêté'];
const AG_INCOME = 'Entrée d’argent';

function agendaList() {
  if (!Array.isArray(data.agenda)) data.agenda = [];
  return data.agenda;
}
const agendaSafeId = (id) => String(id || '').replace(/[^\w-]/g, '');
const agendaById = (id) => agendaList().find((e) => e.id === id);
const agEuros = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const agPad2 = (n) => String(n).padStart(2, '0');
const agFrDate = (d) => `${agPad2(d.getDate())}/${agPad2(d.getMonth() + 1)}`;
const AG_DAYS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

// Même règle que agendaDayRange (server/agent-tools.js).
function agDayRange(day) {
  const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(day || '').trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (a < 1 || a > 31 || b < a || b > 31) return null;
  return [a, b];
}
// Date du jour « day » dans le mois (y, m), ramenée au dernier jour si le mois est plus court.
function dayInMonth(y, m, day) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}
// Prochain passage d'une ligne mensuelle (premier jour de la fourchette) à partir d'aujourd'hui.
function nextPassage(e, now = new Date()) {
  const r = agDayRange(e.day);
  if (!r) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let d = dayInMonth(today.getFullYear(), today.getMonth(), r[0]);
  // Encore dans la fourchette de ce mois-ci : il peut passer aujourd'hui, on le garde.
  const end = dayInMonth(today.getFullYear(), today.getMonth(), r[1]);
  if (end < today) d = dayInMonth(today.getFullYear(), today.getMonth() + 1, r[0]);
  return d;
}
// L'argent doit être là la veille du premier jour possible.
const eveOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);

function agStateBadge(s) {
  return s === 'arrêté' ? 'red' : s === 'à confirmer' ? 'yellow' : 'green';
}

function addAgendaDialog() {
  const kinds = AGENDA_KINDS_UI.map((k) => `<option>${esc(k)}</option>`).join('');
  modal(
    'Ajouter une date à l’agenda',
    `<p class="note">Un prélèvement habituel, un virement à faire, une entrée d’argent ou une date à ne pas rater. Pas de numéro de compte : juste le nom de la banque.</p><label for="agLabel">Libellé</label><input id="agLabel" placeholder="ex. SFR ligne 1, AG copropriété"><label for="agKind">Type</label><select id="agKind">${kinds}</select><div class="grid"><div><label for="agAccount">Compte (banque)</label><input id="agAccount" placeholder="ex. Boursorama"></div><div><label for="agAmount">Montant (€)</label><input id="agAmount" type="number" step="0.01" min="0"></div></div><label for="agRec">Quand</label><select id="agRec"><option value="mensuel">Chaque mois</option><option value="ponctuel">Une fois</option><option value="annuel">Chaque année</option></select><div class="grid"><div><label for="agDay">Jour du mois (chaque mois)</label><input id="agDay" placeholder="ex. 20 ou 9-12"></div><div><label for="agDate">Date (une fois / chaque année)</label><input id="agDate" type="date"></div></div><label for="agMonth">Ou mois supposé</label><input id="agMonth" placeholder="ex. octobre 2027"><label for="agSource">D’où vient l’info</label><input id="agSource" placeholder="ex. relevé d’octobre 2026"><div class="actions">${btn('Ajouter', 'addAgendaEntry()', 'good')}${btn('Annuler', 'closeDialog()')}</div>`,
  );
}
function addAgendaEntry() {
  const val = (id) => String(document.getElementById(id).value || '').trim().slice(0, 160);
  const label = val('agLabel');
  if (!label) return notify('Donne un libellé.');
  const recurrence = ['mensuel', 'ponctuel', 'annuel'].includes(val('agRec')) ? val('agRec') : 'mensuel';
  const day = val('agDay');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(val('agDate')) ? val('agDate') : '';
  const month = val('agMonth');
  if (recurrence === 'mensuel' && day !== 'à choisir' && !agDayRange(day)) return notify('Donne le jour du mois (ex. 20 ou 9-12).');
  if (recurrence !== 'mensuel' && !date && !month) return notify('Donne la date ou le mois supposé.');
  const amount = Math.round(Number(val('agAmount')) * 100) / 100;
  agendaList().push({
    id: 'agenda-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: AGENDA_KINDS_UI.includes(val('agKind')) ? val('agKind') : 'Autre',
    label,
    account: val('agAccount').slice(0, 40),
    recurrence,
    day: recurrence === 'mensuel' ? day : '',
    date: recurrence === 'mensuel' ? '' : date,
    month: recurrence === 'mensuel' ? '' : month,
    amount: amount > 0 ? amount : undefined,
    certainty: recurrence === 'mensuel' || date ? 'sûre' : 'supposée',
    state: 'actif',
    source: val('agSource'),
    addedAt: new Date().toISOString(),
    addedBy: 'walid',
  });
  closeDialog();
  save();
  render();
  notify('Ajouté à l’agenda.');
}
function setAgendaState(id, value) {
  const e = agendaById(id);
  if (!e || !AGENDA_STATES_UI.includes(value)) return;
  e.state = value;
  e.updatedAt = new Date().toISOString();
  e.updatedBy = 'walid';
  save();
  render();
}
function deleteAgendaEntry(id) {
  const e = agendaById(id);
  if (!e) return;
  if (!confirm(`Retirer « ${e.label} » de l’agenda ?`)) return;
  data.agenda = agendaList().filter((x) => x.id !== id);
  save();
  render();
  notify('Retiré de l’agenda.');
}

function agAmountCell(e) {
  if (!(Number(e.amount) > 0)) return '<span class="tiny">—</span>';
  const sign = e.kind === AG_INCOME ? '+ ' : '';
  return `${sign}${esc(agEuros(e.amount))}${e.estimate ? '<div class="tiny">estimation</div>' : ''}`;
}
function agStateCell(e) {
  const sid = agendaSafeId(e.id);
  const opts = AGENDA_STATES_UI.map((s) => `<option${s === e.state ? ' selected' : ''}>${esc(s)}</option>`).join('');
  return `<span class="badge ${agStateBadge(e.state)}" style="margin-bottom:4px">${esc(e.state || 'actif')}</span><br><select onchange="setAgendaState('${sid}',this.value)" style="min-width:110px">${opts}</select>`;
}
function agSubLine(e) {
  return [e.kind, e.payee && e.payee !== e.label ? e.payee : '', e.note, e.source ? 'Source : ' + e.source : ''].filter(Boolean).map(esc).join(' · ');
}

// Les 31 prochains jours : chaque passage mensuel, la veille où l'argent doit être là,
// et le cumul à prévoir par compte depuis aujourd'hui.
function upcomingSection(monthly) {
  const now = new Date();
  const rows = monthly
    .filter((e) => e.state !== 'arrêté')
    .map((e) => ({ e, d: nextPassage(e, now) }))
    .filter((x) => x.d && (x.d - now) / 86400000 < 31)
    .sort((a, b) => a.d - b.d);
  if (!rows.length) return '';
  const cumul = {};
  const body = rows
    .map(({ e, d }) => {
      const acc = e.account || 'compte non précisé';
      const amt = Number(e.amount) || 0;
      if (e.kind !== AG_INCOME) cumul[acc] = (cumul[acc] || 0) + amt;
      const r = agDayRange(e.day);
      const range = r && r[1] !== r[0] ? ` (jusqu’au ${agFrDate(dayInMonth(d.getFullYear(), d.getMonth(), r[1]))})` : '';
      const eve = eveOf(d);
      const when = e.kind === AG_INCOME ? `arrive vers le ${AG_DAYS_FR[d.getDay()]} ${agFrDate(d)}` : `<strong>${AG_DAYS_FR[eve.getDay()]} ${agFrDate(eve)}</strong>`;
      return `<tr${e.state === 'à confirmer' ? ' style="opacity:.7"' : ''}><td style="white-space:nowrap">${when}</td><td><strong>${esc(e.label)}</strong><div class="tiny">passe le ${agFrDate(d)}${range}${e.state === 'à confirmer' ? ' · à confirmer' : ''}</div></td><td>${esc(acc)}</td><td class="r" style="white-space:nowrap">${agAmountCell(e)}</td><td class="r" style="white-space:nowrap">${e.kind === AG_INCOME ? '<span class="tiny">entrée</span>' : esc(agEuros(cumul[acc] || 0))}</td></tr>`;
    })
    .join('');
  return `<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Les 31 prochains jours</h2><p class="tiny">« Argent là avant le » = la veille du premier jour où le prélèvement peut passer. « À prévoir » = total des sorties sur ce compte d’ici là, à partir d’aujourd’hui (les entrées repères sont montrées à part, sans être déduites).</p><div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Argent là avant le</th><th>Quoi</th><th>Compte</th><th class="r">Montant</th><th class="r">À prévoir</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function monthlySection(monthly) {
  if (!monthly.length) return '';
  const sorted = [...monthly].sort((a, b) => (agDayRange(a.day)?.[0] ?? 99) - (agDayRange(b.day)?.[0] ?? 99));
  const totals = {};
  for (const e of monthly) {
    if (e.state === 'arrêté' || !(Number(e.amount) > 0)) continue;
    const acc = e.account || 'compte non précisé';
    const t = (totals[acc] = totals[acc] || { out: 0, in: 0 });
    if (e.kind === AG_INCOME) t.in += Number(e.amount);
    else t.out += Number(e.amount);
  }
  const boxes = Object.entries(totals)
    .map(([acc, t]) => `<div class="metricbox"><span class="tiny">${esc(acc)} : sorties / mois</span><strong>${esc(agEuros(t.out))}</strong>${t.in ? `<span class="tiny">entrées repères ${esc(agEuros(t.in))}</span>` : ''}</div>`)
    .join('');
  const rows = sorted
    .map((e) => {
      const r = agDayRange(e.day);
      const eve = r ? (r[0] > 1 ? `le ${r[0] - 1}` : 'la fin du mois d’avant') : '—';
      const sub = agSubLine(e);
      return `<tr${e.state === 'arrêté' ? ' style="opacity:.5"' : ''}><td style="white-space:nowrap">${esc(r ? (r[0] === r[1] ? `le ${r[0]}` : `du ${r[0]} au ${r[1]}`) : e.day || '—')}</td><td><strong>${esc(e.label)}</strong>${sub ? `<div class="tiny">${sub}</div>` : ''}</td><td>${esc(e.account || '—')}</td><td class="r" style="white-space:nowrap">${agAmountCell(e)}</td><td>${e.kind === AG_INCOME ? '<span class="tiny">entrée</span>' : esc(eve)}</td><td>${agStateCell(e)}</td><td>${btn('✕', `deleteAgendaEntry('${agendaSafeId(e.id)}')`)}</td></tr>`;
    })
    .join('');
  return `${boxes ? `<div class="metricgrid">${boxes}</div>` : ''}<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Chaque mois</h2><div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Passe</th><th>Quoi</th><th>Compte</th><th class="r">Montant</th><th>Argent là avant</th><th>État</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function eventsSection(events) {
  if (!events.length) return '';
  // Tri chronologique : la date connue, sinon le premier mois cité dans « mois » (ex. « février–mars 2027 »).
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const key = (e) => {
    if (e.date) return e.date;
    const txt = String(e.month || '').toLowerCase();
    const y = (/\b(20\d{2})\b/.exec(txt) || [])[1] || '9999';
    const found = MONTHS.map((m, i) => [txt.indexOf(m), i]).filter(([pos]) => pos >= 0).sort((a, b) => a[0] - b[0])[0];
    return `${y}-${agPad2(found ? found[1] + 1 : 12)}-99`;
  };
  const rows = [...events]
    .sort((a, b) => key(a).localeCompare(key(b)))
    .map((e) => {
      let when = e.month || '—';
      if (e.date) {
        const [y, m, d] = e.date.split('-');
        when = `${d}/${m}/${y}`;
      }
      if (e.recurrence === 'annuel') when += ' · chaque année';
      const sub = agSubLine(e);
      return `<tr${e.state === 'arrêté' ? ' style="opacity:.5"' : ''}><td style="white-space:nowrap">${esc(when)}</td><td><strong>${esc(e.label)}</strong>${sub ? `<div class="tiny">${sub}</div>` : ''}</td><td><span class="badge ${e.certainty === 'sûre' ? 'green' : 'gold'}">${e.certainty === 'sûre' ? 'date sûre' : 'supposée'}</span></td><td class="r">${agAmountCell(e)}</td><td>${agStateCell(e)}</td><td>${btn('✕', `deleteAgendaEntry('${agendaSafeId(e.id)}')`)}</td></tr>`;
    })
    .join('');
  return `<section class="tile" style="margin-top:14px"><h2 style="margin-top:0">Réunions et dates à ne pas rater</h2><p class="tiny">Assemblées générales de copropriété, échéances… « Supposée » : déduite des années passées, à confirmer dès que la convocation arrive.</p><div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Quand</th><th>Quoi</th><th>Certitude</th><th class="r">Montant</th><th>État</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function agendaPage() {
  const all = agendaList();
  const monthly = all.filter((e) => e.recurrence === 'mensuel');
  const events = all.filter((e) => e.recurrence !== 'mensuel');
  const head = `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(projectDef.name.toUpperCase())} / AGENDA</div><h1>Agenda</h1><p class="intro">Quand l’argent doit être sur le compte avant chaque prélèvement habituel, les virements à faire à la main, et les dates à ne pas rater (assemblées générales…). Un prélèvement rejeté coûte des frais : vise la veille.</p></div></div>
<div class="actions">${btn('+ Ajouter une date', 'addAgendaDialog()', 'good')}</div>`;
  if (!all.length) return `${head}<div class="empty">Rien dans l’agenda pour l’instant.</div>`;
  return `${head}${upcomingSection(monthly)}${monthlySection(monthly)}${eventsSection(events)}`;
}

// render : ajoute le lien Agenda (après Frais évitables) et affiche sa page.
const baseRenderAgenda = render;
render = function () {
  const isAgenda = location.hash.slice(1) === AGENDA_SLUG;
  baseRenderAgenda();
  const nav = document.getElementById('nav');
  if (isAgenda) nav.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  nav.insertAdjacentHTML('beforeend', `<a href="#${AGENDA_SLUG}" class="${isAgenda ? 'active' : ''}"><span class="num">📅</span>Agenda</a>`);
  if (isAgenda) {
    document.getElementById('breadcrumb').textContent = 'Agenda';
    main.innerHTML = agendaPage();
  }
};

render();
