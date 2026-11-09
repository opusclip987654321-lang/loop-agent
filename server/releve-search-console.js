// Relevé Google Search Console (accès donné par Walid le 09/11/2026 pour vegebudget.fr et
// leviaro.fr). Toutes les 6 heures, Loop Agent lit en LECTURE SEULE, avec le compte de service
// Google « loop-agent@loop-agent-514221.iam.gserviceaccount.com » (ajouté comme utilisateur
// « Restreint » dans Search Console), les recherches Google qui mènent à chaque site :
//   - par jour (30 derniers jours) : clics et affichages → indicateurs du projet ;
//   - sur 28 jours : les requêtes et les pages qui ressortent le plus → lire_projet → search_console.
// Google publie ses chiffres avec 2 à 3 jours de retard : chaque relevé réécrit les 30 jours.
// La clé du compte de service est dans DATA_DIR/search-console.json (droits 600), jamais affichée.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSign } from 'node:crypto';
import { parisDate } from './argent-rappels.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://www.googleapis.com/webmasters/v3';
const SOURCE = 'releve-search-console';
const ORIGIN = 'Google Search Console (recherches Google vers le site), relevé automatique';
export const SITES = { 'vegebudget.fr': 'vegebudget', 'leviaro.fr': 'leviaro', 'nourmeet.com': 'nourmeet' };

// « sc-domain:vegebudget.fr » ou « https://www.vegebudget.fr/ » → projet.
export function projetDuSite(siteUrl) {
  const h = String(siteUrl || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return SITES[h] || null;
}

const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
export function jwt(cle, nowS) {
  const corps = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: cle.client_email, scope: SCOPE, aud: cle.token_uri || 'https://oauth2.googleapis.com/token', iat: nowS, exp: nowS + 3600 })}`;
  return `${corps}.${createSign('RSA-SHA256').update(corps).sign(cle.private_key).toString('base64url')}`;
}

export function appliquer(doc, lu, nowIso) {
  doc.kpis = doc.kpis || [];
  const pris = (re) => doc.kpis.find((k) => re.test(k.name) && k.status !== 'refuse');
  // Créés avec l'accès donné par Walid (09/11/2026) : ce sont les chiffres qu'il a ouverts.
  if (!pris(/venues de google|clics.*google/i))
    doc.kpis.push({ id: 'kpi-gsc-clics', name: 'Clics depuis Google', unit: 'clics', agg: 'somme', direction: 'augmenter', why: 'Les visites que Google amène vraiment, lues dans Search Console (accès donné par Walid le 09/11/2026).', status: 'valide', by: 'walid', at: nowIso });
  if (!pris(/affichages.*google/i))
    doc.kpis.push({ id: 'kpi-gsc-affichages', name: 'Affichages dans Google', unit: 'affichages', agg: 'somme', direction: 'augmenter', why: 'Combien de fois le site apparaît dans les résultats Google, avant même le clic : le premier signe que le SEO marche (accès Search Console donné par Walid le 09/11/2026).', status: 'valide', by: 'walid', at: nowIso });
  const valides = doc.kpis.filter((k) => k.status === 'valide');
  const clics = valides.find((k) => /venues de google|clics.*google/i.test(k.name));
  const affichages = valides.find((k) => /affichages.*google/i.test(k.name));
  doc.kpiValues = doc.kpiValues || [];
  const ecrits = [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'gsc-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: ORIGIN, note, value });
    ecrits.push(kpi.name + ' ' + date);
  };
  for (const r of lu.parJour) {
    const pos = r.position ? `, position moyenne ${Math.round(r.position * 10) / 10}` : '';
    if (clics) poser(clics, r.date, r.clics, `${r.clics} clic(s) depuis une recherche Google sur ${r.affichages} affichage(s)${pos}.`);
    if (affichages) poser(affichages, r.date, r.affichages, `${r.affichages} affichage(s) dans les résultats Google, ${r.clics} clic(s)${pos}.`);
  }
  doc.kpiValues = doc.kpiValues.slice(0, 4000);
  doc.searchConsole = { maj: nowIso, site: lu.site, sur28jours: lu.sur28jours, requetes: lu.requetes, pages: lu.pages };
  // La demande d'accès Search Console de l'agent est satisfaite.
  for (const t of doc.tasks || [])
    for (const i of [t, ...(t.ideas || [])])
      for (const a of i.accessRequests || [])
        if (!a.connected && /search console/i.test(a.name)) (a.connected = true), (a.connectedAt = nowIso);
  return ecrits;
}

export function pourAgent(sc) {
  if (!sc) return undefined;
  return {
    consigne: 'Recherches Google vers le site (Search Console, lecture seule, données avec 2 à 3 jours de retard). Sers-t’en pour juger le SEO : quelles requêtes affichent le site, lesquelles cliquent, quelles pages ressortent.',
    lu_le: sc.maj.slice(0, 10),
    site: sc.site,
    sur_28_jours: sc.sur28jours,
    requetes: sc.requetes,
    pages: sc.pages,
  };
}

export function createReleveSearchConsole({ db, dataDir, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
  const lireCle = () => {
    try {
      const c = JSON.parse(readFileSync(join(dataDir, 'search-console.json'), 'utf8'));
      return c.client_email && c.private_key ? c : null;
    } catch {
      return null;
    }
  };
  async function jeton(cle) {
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt(cle, Math.floor(now() / 1000)) });
    const r = await fetchImpl(cle.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Google refuse la clé du compte de service (${r.status})`);
    return (await r.json()).access_token;
  }
  async function appel(tok, chemin, corps) {
    const r = await fetchImpl(API + chemin, { method: corps ? 'POST' : 'GET', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Search Console répond ${r.status}`);
    return r.json();
  }
  async function lireTout() {
    const cle = lireCle();
    if (!cle) return null;
    const tok = await jeton(cle);
    const sites = ((await appel(tok, '/sites')).siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser' && projetDuSite(s.siteUrl));
    const fin = parisDate(now());
    const debut = (n) => new Date(Date.parse(fin + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
    const out = [];
    for (const s of sites) {
      const q = (dims, jours, rowLimit) => appel(tok, `/sites/${encodeURIComponent(s.siteUrl)}/searchAnalytics/query`, { startDate: debut(jours), endDate: fin, dimensions: dims, rowLimit });
      const parJour = ((await q(['date'], 30, 100)).rows || []).map((r) => ({ date: r.keys[0], clics: r.clicks, affichages: r.impressions, position: r.position }));
      const total = ((await q([], 28, 1)).rows || [])[0] || {};
      const arrondi = (r) => ({ clics: r.clicks || 0, affichages: r.impressions || 0, position: r.position ? Math.round(r.position * 10) / 10 : null });
      const requetes = ((await q(['query'], 28, 15)).rows || []).map((r) => ({ requete: r.keys[0], ...arrondi(r) }));
      const pages = ((await q(['page'], 28, 10)).rows || []).map((r) => ({ page: r.keys[0], ...arrondi(r) }));
      out.push({ projet: projetDuSite(s.siteUrl), site: s.siteUrl, parJour, sur28jours: arrondi(total), requetes, pages });
    }
    return out;
  }
  async function tick() {
    const lus = await lireTout();
    if (!lus) return { ignore: true };
    const t = new Date(now()).toISOString();
    const res = {};
    for (const lu of lus) {
      for (let i = 0; i < 5; i++) {
        const cur = db.getDoc('project:' + lu.projet);
        if (!cur) break;
        const doc = JSON.parse(cur.value);
        const ecrits = appliquer(doc, lu, t);
        if (db.putDoc('project:' + lu.projet, JSON.stringify(doc), cur.version, 'agent:releve-search-console').ok) {
          res[lu.projet] = { site: lu.site, ecrits: ecrits.length, ...lu.sur28jours };
          break;
        }
      }
    }
    return res;
  }
  function start(everyMs = 6 * 60 * 60 * 1000) {
    const run = () => tick().catch((e) => log.error('relevé Search Console', String(e.message || e)));
    const first = setTimeout(run, 240000);
    const timer = setInterval(run, everyMs);
    first.unref();
    timer.unref();
    return () => (clearTimeout(first), clearInterval(timer));
  }
  return { tick, start, lireTout };
}
