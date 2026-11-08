// Surveillance des sites (reprise du cerveau central, étape 2 de sa migration).
// Toutes les 5 minutes : chaque site répond-il ? Chaque certificat HTTPS est-il
// encore valable ? Le disque du serveur de Loop Agent est-il plein ?
// Règles (les mêmes que le cerveau) :
//  - un site qui rate est revérifié 30 s plus tard avant d'alerter ;
//  - une seule alerte par panne, puis « rétabli » avec la durée ;
//  - 🔴 panne : ne répond pas, erreur, certificat expiré ou à moins de 3 jours, disque à 95 % ;
//  - 🟠 à surveiller : lent (> 4 s), certificat à moins de 14 jours, disque à 85 %.
// L'état est gardé dans DATA_DIR/surveillance.json : un redémarrage ne relance pas les alertes.
// Aucun secret : on ne lit que des pages publiques.

import { connect } from 'node:tls';
import { statfs, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const SITES = [
  { id: 'nourmeet', nom: 'Site nourmeet.com', url: 'https://nourmeet.com' },
  { id: 'nourmeet-api', nom: 'API Nūr Meet (base comprise)', url: 'https://api.nourmeet.com/health/ready', json: { status: 'ok' } },
  { id: 'leviaro', nom: 'Site leviaro.fr', url: 'https://leviaro.fr' },
  { id: 'leviaro-admin', nom: 'Admin Leviaro', url: 'https://admin.leviaro.fr', statuts: [200, 301, 302, 401, 403] },
  { id: 'vegebudget', nom: 'Site vegebudget.fr', url: 'https://vegebudget.fr' },
  { id: 'n8n-nour', nom: 'n8n.nourmeet.com', url: 'https://n8n.nourmeet.com/healthz', json: { status: 'ok' } },
  { id: 'n8n-actualite', nom: 'n8n.actualitevideo.fr', url: 'https://n8n.actualitevideo.fr/healthz', json: { status: 'ok' } },
  { id: 'cerveau', nom: 'Cerveau central', url: 'https://cerveau.nourmeet.com/', statuts: [200, 301, 302, 401, 403] },
];
export const CERTIFICATS = ['nourmeet.com', 'api.nourmeet.com', 'leviaro.fr', 'admin.leviaro.fr', 'vegebudget.fr', 'n8n.nourmeet.com', 'n8n.actualitevideo.fr', 'loopagent.actualitevideo.fr'];
export const SEUILS = { lenteurMs: 4000, certAttention: 14, certCritique: 3, disqueAttention: 85, disqueCritique: 95 };

const DAY = 86400000;

export async function checkSite(site, { fetchImpl = globalThis.fetch, timeoutMs = 15000, now = () => Date.now() } = {}) {
  const t0 = now();
  try {
    const res = await fetchImpl(site.url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'LoopAgent-surveillance' } });
    const ms = now() - t0;
    const ok = site.statuts ? site.statuts.includes(res.status) : res.status >= 200 && res.status < 400;
    if (!ok) return { niveau: 'panne', detail: `répond ${res.status}` };
    if (site.json) {
      const j = await res.json().catch(() => null);
      const bad = !j || Object.entries(site.json).some(([k, v]) => j[k] !== v);
      if (bad) return { niveau: 'panne', detail: 'répond, mais signale un problème' };
    }
    if (ms > SEUILS.lenteurMs) return { niveau: 'attention', detail: `lent (${(ms / 1000).toFixed(1)} s)` };
    return { niveau: 'ok', detail: `${ms} ms` };
  } catch (e) {
    return { niveau: 'panne', detail: e?.name === 'TimeoutError' ? 'ne répond pas (délai dépassé)' : 'ne répond pas' };
  }
}

export function certDaysLeft(host, { timeoutMs = 10000, connectImpl = connect, now = () => Date.now() } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const end = (v) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {}
      resolve(v);
    };
    const sock = connectImpl({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = sock.getPeerCertificate();
      end(c && c.valid_to ? { jours: Math.floor((Date.parse(c.valid_to) - now()) / DAY) } : { erreur: 'pas de certificat' });
    });
    sock.on('error', () => end({ erreur: 'injoignable' }));
    sock.on('timeout', () => end({ erreur: 'délai dépassé' }));
  });
}

export function certLevel(r) {
  if (r.erreur) return { niveau: 'panne', detail: `certificat illisible (${r.erreur})` };
  if (r.jours < 0) return { niveau: 'panne', detail: 'certificat expiré' };
  if (r.jours < SEUILS.certCritique) return { niveau: 'panne', detail: `certificat expire dans ${r.jours} j` };
  if (r.jours < SEUILS.certAttention) return { niveau: 'attention', detail: `certificat expire dans ${r.jours} j` };
  return { niveau: 'ok', detail: `${r.jours} j` };
}

export function diskLevel(pct) {
  if (pct >= SEUILS.disqueCritique) return { niveau: 'panne', detail: `disque plein à ${pct} %` };
  if (pct >= SEUILS.disqueAttention) return { niveau: 'attention', detail: `disque à ${pct} %` };
  return { niveau: 'ok', detail: `${pct} %` };
}

function duree(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} j`;
}

// Applique un résultat à l'état et renvoie le message à envoyer (ou null).
export function transition(state, key, nom, r, t) {
  const prev = state[key] || { niveau: 'ok' };
  if (r.niveau === prev.niveau) {
    state[key] = { ...prev, detail: r.detail, vu: t };
    return null;
  }
  state[key] = { niveau: r.niveau, detail: r.detail, depuis: t, vu: t };
  if (r.niveau === 'ok') return prev.niveau === 'panne' || prev.niveau === 'attention' ? `🟢 Rétabli : ${nom} (après ${duree(t - (prev.depuis || t))})` : null;
  if (r.niveau === 'panne') return `🔴 Panne : ${nom} — ${r.detail}`;
  return prev.niveau === 'panne' ? null : `🟠 À surveiller : ${nom} — ${r.detail}`;
}

export function createSurveillance({
  dataDir,
  notify = async () => {},
  fetchImpl = globalThis.fetch,
  connectImpl = connect,
  statfsImpl = statfs,
  now = () => Date.now(),
  retryMs = 30000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  sites = SITES,
  certificats = CERTIFICATS,
  log = console,
}) {
  const file = join(dataDir, 'surveillance.json');
  let state = null;
  async function load() {
    if (state) return state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      state = {};
    }
    return state;
  }
  async function save() {
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, file);
  }

  let running = null;
  async function run() {
    await load();
    const messages = [];
    const results = await Promise.all(
      sites.map(async (s) => {
        let r = await checkSite(s, { fetchImpl, now });
        if (r.niveau === 'panne') {
          await sleep(retryMs);
          r = await checkSite(s, { fetchImpl, now });
        }
        return [s, r];
      }),
    );
    for (const [s, r] of results) {
      const m = transition(state, 'site:' + s.id, s.nom, r, now());
      if (m) messages.push(m);
    }
    for (const host of certificats) {
      const r = certLevel(await certDaysLeft(host, { connectImpl, now }));
      const m = transition(state, 'cert:' + host, `Certificat ${host}`, r, now());
      if (m) messages.push(m);
    }
    try {
      const s = await statfsImpl(dataDir);
      const pct = Math.round((1 - s.bavail / s.blocks) * 100);
      const m = transition(state, 'disque', 'Disque du serveur Loop Agent', diskLevel(pct), now());
      if (m) messages.push(m);
    } catch (e) {
      log.error('surveillance disque', String(e.message || e));
    }
    await save().catch((e) => log.error('surveillance état', String(e.message || e)));
    if (messages.length) await notify(['🛰 Surveillance', ...messages].join('\n')).catch((e) => log.error('surveillance telegram', String(e.message || e)));
    return messages;
  }
  function tick() {
    if (!running) running = run().finally(() => (running = null));
    return running;
  }
  function start(everyMs = 5 * 60 * 1000) {
    const first = setTimeout(() => tick().catch(() => {}), 20000);
    const t = setInterval(() => tick().catch(() => {}), everyMs);
    first.unref();
    t.unref();
    return () => (clearTimeout(first), clearInterval(t));
  }
  return { tick, start, state: () => state };
}
