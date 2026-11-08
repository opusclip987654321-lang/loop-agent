// Rappels de la page Argent sur Telegram (reprise du résumé du matin du cerveau central).
//  - Renouvellements : un abonnement qui se renouvelle dans 3 jours ou moins → un message,
//    une seule fois par échéance.
//  - Bilan du mois : le 1er du mois, à partir de 9 h (Paris), le total du mois fini,
//    une seule fois par mois.
// Mêmes calculs que la page Argent (public/app.js : nextDue, monthly, subsActiveIn, rechargesIn) :
// un abonnement annuel compte pour 1/12 chaque mois, une recharge compte le mois de sa date.
// L'état (ce qui a déjà été envoyé) est gardé dans DATA_DIR/argent-rappels.json.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const DAY = 86400000;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function parisDate(t = Date.now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(t));
}
export function parisHour(t = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  return Number(parts.find((p) => p.type === 'hour').value);
}

export function nextDue(e, today) {
  let [y, m, d] = String(e.date || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const iso = () => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
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

const monthly = (e) => (e.freq === 'mois' ? e.amount : e.freq === 'an' ? e.amount / 12 : 0);
const add = (o, c, v) => (v ? ((o[c] = (o[c] || 0) + v), o) : o);
export function fmtSum(o) {
  const parts = Object.keys(o)
    .filter((c) => Math.round(o[c] * 100) !== 0)
    .map((c) => {
      const v = Math.round(o[c] * 100) / 100;
      return `${v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} ${c}`;
    });
  return parts.length ? parts.join(' + ') : '0';
}
export function prevMonth(k) {
  let [y, m] = k.split('-').map(Number);
  if (--m < 1) {
    m = 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Total d'un mois (AAAA-MM), comme la page Argent : abonnements actifs + recharges du mois.
export function monthTotals(money, k) {
  const ex = money.expenses || [];
  const subs = ex.filter((e) => e.freq !== 'une fois' && (!e.since || e.since <= k));
  const rech = ex.filter((e) => e.freq === 'une fois' && String(e.date || '').slice(0, 7) === k);
  const abonnements = {},
    recharges = {},
    total = {},
    parProjet = {};
  for (const e of subs) {
    add(abonnements, e.cur, monthly(e));
    add(total, e.cur, monthly(e));
    add((parProjet[e.project] = parProjet[e.project] || {}), e.cur, monthly(e));
  }
  for (const e of rech) {
    add(recharges, e.cur, e.amount);
    add(total, e.cur, e.amount);
    add((parProjet[e.project] = parProjet[e.project] || {}), e.cur, e.amount);
  }
  return { abonnements, recharges, total, parProjet, nbRecharges: rech.length };
}

export function renewalsDue(money, today, withinDays = 3) {
  const out = [];
  for (const e of money.expenses || []) {
    if (e.freq === 'une fois' || !e.date) continue;
    const due = nextDue(e, today);
    if (!due) continue;
    const days = Math.round((Date.parse(due) - Date.parse(today)) / DAY);
    if (days >= 0 && days <= withinDays) out.push({ e, due, days });
  }
  return out;
}

export function createArgentRappels({ db, dataDir, notify = async () => {}, now = () => Date.now(), bilanHour = 9, log = console }) {
  const file = join(dataDir, 'argent-rappels.json');
  async function loadState() {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return { renouvellements: {}, bilans: {} };
    }
  }
  async function saveState(s) {
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify(s, null, 2));
    await rename(tmp, file);
  }
  function money() {
    const d = db.getDoc('money');
    try {
      return d ? JSON.parse(d.value) : { expenses: [] };
    } catch {
      return { expenses: [] };
    }
  }

  async function tick() {
    const t = now();
    const today = parisDate(t);
    const m = money();
    const state = await loadState();
    state.renouvellements = state.renouvellements || {};
    state.bilans = state.bilans || {};
    const sent = [];

    const daytime = parisHour(t) >= bilanHour && parisHour(t) < 22;
    const due = daytime ? renewalsDue(m, today).filter(({ e, due }) => !state.renouvellements[`${e.id}|${due}`]) : [];
    if (due.length) {
      const lines = due.map(({ e, due, days }) => {
        const quand = days === 0 ? 'aujourd’hui' : days === 1 ? 'demain' : `dans ${days} jours`;
        const fact = e.invoice ? '' : ' · pas de facture rangée';
        return `• ${e.name} — ${fmtSum({ [e.cur]: e.amount })} ${e.freq === 'an' ? 'par an' : 'par mois'}, ${quand} (${due.slice(8, 10)}/${due.slice(5, 7)}) · ${e.project}${fact}`;
      });
      await notify(`🔁 Renouvellements à venir\n${lines.join('\n')}`);
      for (const { e, due: d } of due) state.renouvellements[`${e.id}|${d}`] = today;
      sent.push('renouvellements');
    }

    const k = today.slice(0, 7);
    const fini = prevMonth(k);
    if (today.endsWith('-01') && parisHour(t) >= bilanHour && !state.bilans[fini]) {
      const r = monthTotals(m, fini);
      const [y, mm] = fini.split('-').map(Number);
      const projets = Object.entries(r.parProjet)
        .map(([p, o]) => [p, o, Object.values(o).reduce((a, b) => a + b, 0)])
        .sort((a, b) => b[2] - a[2])
        .slice(0, 6)
        .map(([p, o]) => `• ${p} : ${fmtSum(o)}`);
      await notify(
        [
          `💶 Dépenses de ${MOIS[mm - 1]} ${y} : ${fmtSum(r.total)}`,
          `Abonnements : ${fmtSum(r.abonnements)} · Recharges : ${fmtSum(r.recharges)} (${r.nbRecharges})`,
          ...(projets.length ? ['', ...projets] : []),
          '',
          'Les euros et les dollars ne sont jamais additionnés. Détail dans Loop Agent, page Argent.',
        ].join('\n'),
      );
      state.bilans[fini] = today;
      sent.push('bilan');
    }

    // On oublie les échéances passées depuis plus de 60 jours.
    for (const [key, d] of Object.entries(state.renouvellements)) if (Date.parse(today) - Date.parse(d) > 60 * DAY) delete state.renouvellements[key];
    if (sent.length) await saveState(state).catch((e) => log.error('rappels argent', String(e.message || e)));
    return sent;
  }

  let running = null;
  function safeTick() {
    if (!running)
      running = tick()
        .catch((e) => (log.error('rappels argent', String(e.message || e)), []))
        .finally(() => (running = null));
    return running;
  }
  function start(everyMs = 30 * 60 * 1000) {
    const first = setTimeout(safeTick, 60000);
    const t = setInterval(safeTick, everyMs);
    first.unref();
    t.unref();
    return () => (clearTimeout(first), clearInterval(t));
  }
  return { tick, start };
}
