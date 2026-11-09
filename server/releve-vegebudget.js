// Relevé des chiffres de vegebudget.fr (reprise du cerveau central, src/vegebudget.js).
// Chaque heure, Loop Agent lit GET https://vegebudget.fr/api/stats (protégé par un jeton rangé
// dans DATA_DIR/vegebudget.json, droits 600, par scripts/vegebudget-jeton.js) et remplit les
// indicateurs validés du projet « vegebudget » :
//   « …visite… »      (somme)   = visiteurs du jour ;
//   « …inscription… » (somme)   = inscrits du jour ;
//   « …abonn… »       (dernier) = nombre total d'abonnés payants, noté à la date du jour.
// Pour un jour donné, la mesure lue sur le site remplace toute autre mesure du même indicateur
// (pas de double compte). Rien d'autre n'est gardé : seulement des nombres.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parisDate } from './argent-rappels.js';

const SOURCE = 'releve-vegebudget';
const ORIGIN = 'vegebudget.fr, /api/stats (relevé automatique chaque heure)';
const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);

export function lireStats(rep) {
  if (!rep || !Array.isArray(rep.jours)) throw new Error('réponse de vegebudget.fr illisible');
  const jours = rep.jours
    .filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j?.jour ?? ''))
    .map((j) => ({ jour: j.jour, visiteurs: n(j.visiteurs), inscrits: n(j.inscrits) }));
  return { jours, abonnes: n(rep.totaux?.abonnes), membres: n(rep.totaux?.membres) };
}

export function appliquer(doc, stats, aujourdhui, nowIso) {
  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  const visites = kpis.find((k) => /visite/i.test(k.name));
  const inscriptions = kpis.find((k) => /inscription/i.test(k.name));
  const abonnes = kpis.find((k) => /abonn/i.test(k.name));
  doc.kpiValues = doc.kpiValues || [];
  const ecrits = [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'vb-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: ORIGIN, note, value });
    ecrits.push(kpi.name + ' ' + date);
  };
  for (const j of stats.jours.slice(-10)) {
    if (visites && j.visiteurs !== null) poser(visites, j.jour, j.visiteurs, `${j.visiteurs} visiteur(s) ce jour-là.`);
    if (inscriptions && j.inscrits !== null) poser(inscriptions, j.jour, j.inscrits, `${j.inscrits} inscription(s) ce jour-là.`);
  }
  if (abonnes && stats.abonnes !== null) poser(abonnes, aujourdhui, stats.abonnes, `${stats.abonnes} abonné(s) payant(s) au total${stats.membres !== null ? `, ${stats.membres} membre(s) inscrit(s)` : ''}.`);
  doc.kpiValues = doc.kpiValues.slice(0, 2000);
  return ecrits;
}

export function createReleveVegebudget({ db, dataDir, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
  function conf() {
    try {
      const c = JSON.parse(readFileSync(join(dataDir, 'vegebudget.json'), 'utf8'));
      return c && typeof c.jeton === 'string' && c.jeton.length >= 16 ? c : null;
    } catch {
      return null;
    }
  }
  async function tick() {
    const c = conf();
    if (!c) return { ignore: true };
    const r = await fetchImpl(new URL('/api/stats?jours=10', c.url || 'https://vegebudget.fr'), { headers: { authorization: `Bearer ${c.jeton}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`vegebudget.fr répond ${r.status}`);
    const stats = lireStats(await r.json());
    const t = now();
    for (let i = 0; i < 5; i++) {
      const cur = db.getDoc('project:vegebudget');
      if (!cur) return { ignore: true };
      const doc = JSON.parse(cur.value);
      const ecrits = appliquer(doc, stats, parisDate(t), new Date(t).toISOString());
      if (db.putDoc('project:vegebudget', JSON.stringify(doc), cur.version, 'agent:releve-vegebudget').ok) return { ecrits };
    }
    throw new Error('document occupé');
  }
  function start(everyMs = 60 * 60 * 1000) {
    const run = () => tick().catch((e) => log.error('relevé VégéBudget', String(e.message || e)));
    const first = setTimeout(run, 120000);
    const timer = setInterval(run, everyMs);
    first.unref();
    timer.unref();
    return () => (clearTimeout(first), clearInterval(timer));
  }
  return { tick, start };
}
