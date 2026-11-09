// Relevé Patreon d'Impacteur Communauté (demande de Walid du 09/11/2026).
// Toutes les 3 heures, Loop Agent lit chez Patreon (API v2, en lecture) les membres de la
// campagne, et remplit les indicateurs validés du projet « impacteur-communaute » :
//   « …nouveaux membres… » (somme)   = membres actifs arrivés ce jour-là ;
//   « …revenus… »          (dernier) = total payé chaque mois par les membres actifs.
// Seuls des nombres entrent dans Loop Agent : ni nom, ni adresse.
// Les accès (identifiant, secret, clé d'accès, clé de renouvellement) sont dans
// DATA_DIR/patreon.json (droits 600), rangés par scripts/patreon-jeton.js. La clé d'accès
// expire : elle est renouvelée ici, toute seule, et le fichier est mis à jour.

import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { parisDate } from './argent-rappels.js';

const API = 'https://www.patreon.com/api/oauth2';
const UA = 'Loop Agent - releve Impacteur Communaute';
const SOURCE = 'releve-patreon';
const ORIGIN = 'Patreon (API v2, membres de la campagne), relevé automatique';

export function lireMembres(pages) {
  const membres = pages.flatMap((p) => (Array.isArray(p?.data) ? p.data : [])).map((m) => m?.attributes || {});
  const actifs = membres.filter((a) => a.patron_status === 'active_patron');
  const centimes = actifs.reduce((s, a) => s + (Number(a.currently_entitled_amount_cents) || 0), 0);
  const arrivees = {};
  for (const a of actifs) {
    const d = a.pledge_relationship_start ? parisDate(Date.parse(a.pledge_relationship_start)) : null;
    if (d) arrivees[d] = (arrivees[d] || 0) + 1;
  }
  return { actifs: actifs.length, revenusMois: Math.round(centimes) / 100, arrivees };
}

export function appliquer(doc, lu, aujourdhui, nowIso) {
  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  const nouveaux = kpis.find((k) => /nouveaux membres/i.test(k.name));
  const revenus = kpis.find((k) => /revenu/i.test(k.name));
  doc.kpiValues = doc.kpiValues || [];
  const ecrits = [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'pa-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: ORIGIN, note, value });
    ecrits.push(kpi.name + ' ' + date);
  };
  if (nouveaux)
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.parse(aujourdhui + 'T12:00:00Z') - i * 86400000).toISOString().slice(0, 10);
      poser(nouveaux, d, lu.arrivees[d] || 0, `${lu.arrivees[d] || 0} nouveau(x) membre(s) actif(s) arrivé(s) ce jour-là.`);
    }
  if (revenus) poser(revenus, aujourdhui, lu.revenusMois, `${lu.actifs} membre(s) actif(s), ${lu.revenusMois} par mois au total (devise de la campagne Patreon).`);
  doc.kpiValues = doc.kpiValues.slice(0, 2000);
  return ecrits;
}

export function createRelevePatreon({ db, dataDir, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
  const file = join(dataDir, 'patreon.json');
  const lire = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const ecrire = (c) => {
    writeFileSync(file + '.tmp', JSON.stringify(c), { mode: 0o600 });
    renameSync(file + '.tmp', file);
    chmodSync(file, 0o600);
  };
  async function renouveler(c) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.client_id, client_secret: c.client_secret });
    const r = await fetchImpl(API + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`renouvellement de la clé Patreon refusé (${r.status}) : recrée la clé sur Patreon`);
    const j = await r.json();
    const n = { ...c, access_token: j.access_token, refresh_token: j.refresh_token || c.refresh_token, expire: now() + (Number(j.expires_in) || 2592000) * 1000 };
    ecrire(n);
    return n;
  }
  async function get(c, url) {
    let r = await fetchImpl(url, { headers: { authorization: `Bearer ${c.access_token}`, 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    if (r.status === 401) {
      c = await renouveler(c);
      r = await fetchImpl(url, { headers: { authorization: `Bearer ${c.access_token}`, 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    }
    if (!r.ok) throw new Error(`Patreon répond ${r.status}`);
    return { c, j: await r.json() };
  }
  async function lireTout() {
    let c = lire();
    if (!c || !c.access_token) return null;
    if (c.expire && c.expire - now() < 3 * 86400000) c = await renouveler(c);
    let res = await get(c, `${API}/v2/campaigns`);
    c = res.c;
    const campagne = res.j?.data?.[0]?.id;
    if (!campagne) throw new Error('aucune campagne Patreon trouvée avec cette clé');
    const pages = [];
    let url = `${API}/v2/campaigns/${encodeURIComponent(campagne)}/members?fields%5Bmember%5D=patron_status,currently_entitled_amount_cents,pledge_relationship_start&page%5Bcount%5D=1000`;
    for (let i = 0; i < 20 && url; i++) {
      res = await get(c, url);
      c = res.c;
      pages.push(res.j);
      const next = res.j?.meta?.pagination?.cursors?.next;
      url = next ? `${API}/v2/campaigns/${encodeURIComponent(campagne)}/members?fields%5Bmember%5D=patron_status,currently_entitled_amount_cents,pledge_relationship_start&page%5Bcount%5D=1000&page%5Bcursor%5D=${encodeURIComponent(next)}` : null;
    }
    return lireMembres(pages);
  }
  async function tick() {
    const lu = await lireTout();
    if (!lu) return { ignore: true };
    const t = now();
    for (let i = 0; i < 5; i++) {
      const cur = db.getDoc('project:impacteur-communaute');
      if (!cur) return { ignore: true };
      const doc = JSON.parse(cur.value);
      const ecrits = appliquer(doc, lu, parisDate(t), new Date(t).toISOString());
      if (db.putDoc('project:impacteur-communaute', JSON.stringify(doc), cur.version, 'agent:releve-patreon').ok) return { ecrits, ...lu };
    }
    throw new Error('document occupé');
  }
  function start(everyMs = 3 * 60 * 60 * 1000) {
    const run = () => tick().catch((e) => log.error('relevé Patreon', String(e.message || e)));
    const first = setTimeout(run, 180000);
    const timer = setInterval(run, everyMs);
    first.unref();
    timer.unref();
    return () => (clearTimeout(first), clearInterval(timer));
  }
  return { tick, start, lireTout };
}
