// Compte rendu SEO hebdomadaire de chaque site (reprise du cerveau central, src/seo.js, sans IA).
// Chaque dimanche à partir de 8 h (Paris), Loop Agent ouvre chaque site comme Google : page
// d'accueil (titre, description, balises, vitesse), robots.txt, sitemap, quelques pages du sitemap,
// llms.txt et l'accès laissé aux robots des IA. Il en tire une note sur 100 et les actions possibles,
// rangées par importance. Rien n'est inventé : ce qui n'a pas pu être lu ne compte pas dans la note.
// Le résultat est rangé dans le projet (doc.seo, 26 semaines), visible des agents par lire_projet,
// et résumé sur Telegram. Les 17 contrôles et leurs poids sont ceux du cerveau, à l'identique.
// Non repris : les visites venues des moteurs (Umami) et la fiche de l'app dans les stores.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parisDate, parisHour } from './argent-rappels.js';

export const SITES_SEO = [
  { projet: 'nourmeet', site: 'https://nourmeet.com' },
  { projet: 'vegebudget', site: 'https://vegebudget.fr' },
  { projet: 'leviaro', site: 'https://leviaro.fr' },
];

const LIMITE_HTML = 2_000_000;
// Les robots des IA à laisser passer pour être cité par ChatGPT, Claude, Perplexity, Google IA.
export const ROBOTS_IA = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended'];

const txt = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const entites = (t) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

// Les attributs d'une balise (<meta name="x" content="y">), quel que soit leur ordre.
function attributs(balise) {
  const a = {};
  for (const m of balise.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = entites(m[3] ?? m[4] ?? m[5] ?? '');
  return a;
}

// Ce qu'un moteur lit dans une page HTML.
export function analyserHtml(html) {
  const h = String(html ?? '');
  const metas = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => attributs(m[0]));
  const meta = (cle) => metas.find((m) => (m.name ?? m.property ?? '').toLowerCase() === cle)?.content;
  const liens = [...h.matchAll(/<link\b[^>]*>/gi)].map((m) => attributs(m[0]));
  const types = [];
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const x of [j, ...(Array.isArray(j) ? j : []), ...(j?.['@graph'] ?? [])]) if (x?.['@type']) types.push(...[].concat(x['@type']).map(String));
    } catch {
      types.push('illisible');
    }
  }
  const images = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => attributs(m[0]));
  return {
    titre: txt(entites(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), 200) || null,
    description: txt(meta('description'), 400) || null,
    h1: (h.match(/<h1\b/gi) ?? []).length,
    canonique: liens.find((l) => (l.rel ?? '').toLowerCase() === 'canonical')?.href ?? null,
    noindex: /noindex/i.test(meta('robots') ?? '') || /noindex/i.test(meta('googlebot') ?? ''),
    langue: attributs(h.match(/<html\b[^>]*>/i)?.[0] ?? '').lang ?? null,
    viewport: Boolean(meta('viewport')),
    ogTitre: Boolean(meta('og:title')),
    ogImage: Boolean(meta('og:image')),
    donneesStructurees: [...new Set(types)].slice(0, 10),
    images: images.length,
    imagesSansAlt: images.filter((i) => !('alt' in i)).length,
  };
}

// Les règles du robots.txt : ce qui est fermé à tous (*) et à chaque robot d'IA, et les sitemaps déclarés.
export function analyserRobots(texte) {
  const groupes = [];
  let courant = null;
  const sitemaps = [];
  for (const brute of String(texte ?? '').split(/\r?\n/)) {
    const ligne = brute.replace(/#.*/, '').trim();
    const m = ligne.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [cle, valeur] = [m[1].toLowerCase(), m[2].trim()];
    if (cle === 'sitemap') sitemaps.push(valeur);
    else if (cle === 'user-agent') {
      if (!courant || courant.regles.length) groupes.push((courant = { agents: [], regles: [] }));
      courant.agents.push(valeur.toLowerCase());
    } else if ((cle === 'disallow' || cle === 'allow') && courant) courant.regles.push({ cle, valeur });
  }
  // Un robot suit son groupe s'il en a un, sinon celui de « * ». Fermé = « Disallow: / » sans « Allow: / ».
  const ferme = (agent) => {
    const g = groupes.find((x) => x.agents.includes(agent.toLowerCase())) ?? groupes.find((x) => x.agents.includes('*'));
    if (!g) return false;
    return g.regles.some((r) => r.cle === 'disallow' && r.valeur === '/') && !g.regles.some((r) => r.cle === 'allow' && r.valeur === '/');
  };
  return { toutFerme: ferme('Googlebot'), iaFermees: ROBOTS_IA.filter(ferme), sitemaps };
}

// Les adresses d'un sitemap, ou des sitemaps qu'il regroupe.
export function analyserSitemap(xml) {
  const x = String(xml ?? '');
  const locs = [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => entites(m[1]));
  return /<sitemapindex/i.test(x) ? { index: true, sitemaps: locs, urls: [] } : { index: false, sitemaps: [], urls: locs };
}

// Un appel HTTP qui ne casse jamais l'audit : statut, durée, texte (tronqué).
async function lire(f, url, delaiMs) {
  const debut = Date.now();
  try {
    const r = await f(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; LoopAgent-SEO/1.0)' }, signal: AbortSignal.timeout(delaiMs) });
    const texte = (await r.text()).slice(0, LIMITE_HTML);
    return { statut: r.status, ok: r.ok, ms: Date.now() - debut, texte, url: r.url || url };
  } catch (err) {
    return { statut: 0, ok: false, ms: Date.now() - debut, texte: '', erreur: txt(err.message, 160), url };
  }
}

// Les contrôles, leur poids dans la note et l'action proposée quand ils échouent.
// qui : « loop » = gratuit et réversible, la loop du projet peut le faire seule ; « louis » = un compte à lui.
const CONTROLES = [
  { cle: 'repond', nom: 'Le site répond', poids: 15, qui: 'loop', action: 'Le site ne répond pas correctement à Google : le remettre en marche avant tout le reste.' },
  { cle: 'indexable', nom: 'Google a le droit d’indexer la page d’accueil', poids: 15, qui: 'loop', action: 'Retirer le « noindex » ou le « Disallow: / » qui cache le site à Google.' },
  { cle: 'titre', nom: 'Titre de page (10 à 65 caractères)', poids: 10, qui: 'loop', action: 'Écrire un titre de page de 10 à 65 caractères avec le mot-clé principal (ce que les gens tapent dans Google).' },
  { cle: 'description', nom: 'Description (50 à 160 caractères)', poids: 10, qui: 'loop', action: 'Écrire une meta description de 50 à 160 caractères qui donne envie de cliquer depuis Google.' },
  { cle: 'rapide', nom: 'Page d’accueil servie en moins de 1,5 s', poids: 10, qui: 'loop', action: 'Accélérer la page d’accueil (images compressées, moins de scripts) : Google classe moins bien les sites lents.' },
  { cle: 'sitemap', nom: 'Sitemap lisible', poids: 8, qui: 'loop', action: 'Publier un sitemap.xml qui liste toutes les pages utiles et le déclarer dans robots.txt.' },
  { cle: 'robots', nom: 'robots.txt présent', poids: 6, qui: 'loop', action: 'Publier un robots.txt qui autorise tout et donne l’adresse du sitemap.' },
  { cle: 'pages', nom: 'Pages du sitemap en ligne, avec titre et description uniques', poids: 6, qui: 'loop', action: 'Corriger les pages du sitemap en erreur ou sans titre/description propres (un titre différent par page).' },
  { cle: 'h1', nom: 'Un titre principal (h1)', poids: 5, qui: 'loop', action: 'Mettre un seul titre principal (h1) sur la page d’accueil, avec le mot-clé principal.' },
  { cle: 'canonique', nom: 'Adresse canonique', poids: 5, qui: 'loop', action: 'Ajouter une balise canonical sur chaque page pour éviter les doublons aux yeux de Google.' },
  { cle: 'mobile', nom: 'Adapté au mobile (viewport)', poids: 5, qui: 'loop', action: 'Ajouter la balise viewport : Google indexe d’abord la version mobile.' },
  { cle: 'structure', nom: 'Données structurées (schema.org)', poids: 5, qui: 'loop', action: 'Ajouter des données structurées schema.org (Organization, et Event, Recipe, FAQ selon les pages) : extraits enrichis dans Google et meilleures chances d’être cité par les IA.' },
  { cle: 'ia', nom: 'Robots des IA autorisés (ChatGPT, Claude, Perplexity, Google IA)', poids: 4, qui: 'loop', action: 'Ouvrir robots.txt aux robots des IA (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended) pour pouvoir être cité dans leurs réponses.' },
  { cle: 'partage', nom: 'Aperçu de partage (og:title et og:image)', poids: 4, qui: 'loop', action: 'Ajouter og:title et og:image : un lien partagé sur les réseaux s’affiche avec une image, plus de clics.' },
  { cle: 'langue', nom: 'Langue déclarée', poids: 3, qui: 'loop', action: 'Déclarer la langue (<html lang="fr">) pour être bien rangé dans Google France.' },
  { cle: 'images', nom: 'Images avec texte alternatif', poids: 2, qui: 'loop', action: 'Donner un texte alternatif (alt) à chaque image : lu par Google Images et par les lecteurs d’écran.' },
  { cle: 'llms', nom: 'Fichier llms.txt pour les IA', poids: 2, qui: 'loop', action: 'Publier un /llms.txt qui résume le site en quelques lignes pour les IA.' },
];

// L'audit d'un site : chaque contrôle vaut vrai, faux ou null (pas pu le savoir).
export async function auditerSite(adresse, { fetch: f = fetch, delaiMs = 15_000, maxPages = 5 } = {}) {
  const base = new URL(adresse);
  const accueil = await lire(f, base.href, delaiMs);
  const page = accueil.ok ? analyserHtml(accueil.texte) : null;
  const robotsLu = await lire(f, new URL('/robots.txt', base).href, delaiMs);
  const robots = robotsLu.ok && !/<html/i.test(robotsLu.texte.slice(0, 500)) ? analyserRobots(robotsLu.texte) : null;

  // Le sitemap déclaré dans robots.txt, sinon /sitemap.xml ; un index est déplié (3 sitemaps au plus).
  const urls = [];
  let sitemapLu = false;
  for (const adr of robots?.sitemaps?.length ? robots.sitemaps.slice(0, 2) : [new URL('/sitemap.xml', base).href]) {
    const s = await lire(f, adr, delaiMs);
    if (!s.ok || !/<(urlset|sitemapindex)/i.test(s.texte)) continue;
    sitemapLu = true;
    const lu = analyserSitemap(s.texte);
    urls.push(...lu.urls);
    for (const sous of lu.sitemaps.slice(0, 3)) {
      const t = await lire(f, sous, delaiMs);
      if (t.ok) urls.push(...analyserSitemap(t.texte).urls);
    }
  }
  const pagesSitemap = [...new Set(urls)];

  // Quelques pages du sitemap (hors accueil), pour voir si elles sont en ligne et bien titrées.
  const echantillon = pagesSitemap.filter((u) => u.replace(/\/$/, '') !== base.href.replace(/\/$/, '')).slice(0, maxPages);
  const pages = [];
  for (const u of echantillon) {
    const r = await lire(f, u, delaiMs);
    const a = r.ok ? analyserHtml(r.texte) : null;
    pages.push({ url: txt(u, 200), statut: r.statut, titre: a?.titre ?? null, description: Boolean(a?.description), noindex: Boolean(a?.noindex) });
  }
  const titres = pages.map((p) => p.titre).filter(Boolean);

  const llms = await lire(f, new URL('/llms.txt', base).href, delaiMs);
  const longueur = (t, min, max) => (t ? t.length >= min && t.length <= max : false);
  const siPage = (fn) => (page ? fn(page) : null);
  const ok = {
    repond: accueil.ok,
    indexable: page ? !page.noindex && !robots?.toutFerme : null,
    titre: siPage((p) => longueur(p.titre, 10, 65)),
    description: siPage((p) => longueur(p.description, 50, 160)),
    rapide: accueil.ok ? accueil.ms < 1500 : null,
    sitemap: sitemapLu && pagesSitemap.length > 0,
    robots: Boolean(robots),
    pages: pages.length ? pages.every((p) => p.statut === 200 && p.titre && p.description && !p.noindex) && new Set(titres).size === titres.length : null,
    h1: siPage((p) => p.h1 === 1),
    canonique: siPage((p) => Boolean(p.canonique)),
    mobile: siPage((p) => p.viewport),
    structure: siPage((p) => p.donneesStructurees.length > 0 && !p.donneesStructurees.includes('illisible')),
    ia: robots ? robots.iaFermees.length === 0 : accueil.ok ? true : null,
    partage: siPage((p) => p.ogTitre && p.ogImage),
    langue: siPage((p) => Boolean(p.langue)),
    images: siPage((p) => p.imagesSansAlt === 0),
    llms: accueil.ok ? llms.ok && !/<html/i.test(llms.texte.slice(0, 500)) : null,
  };
  return {
    url: base.href,
    statut: accueil.statut,
    erreur: accueil.erreur ?? null,
    ms: accueil.ok ? accueil.ms : null,
    page,
    robots: robots ? { iaFermees: robots.iaFermees, sitemaps: robots.sitemaps.slice(0, 5) } : null,
    sitemap: sitemapLu ? pagesSitemap.length : null,
    pages,
    controles: CONTROLES.map((c) => ({ cle: c.cle, nom: c.nom, poids: c.poids, ok: ok[c.cle] })),
  };
}


// La note sur 100 (contrôles connus seulement) et les actions possibles, les plus lourdes d'abord.
export function noter(audit, { maxActions = 6 } = {}) {
  const connus = audit.controles.filter((c) => c.ok !== null);
  const total = connus.reduce((s, c) => s + c.poids, 0);
  const note = total ? Math.round((connus.filter((c) => c.ok).reduce((s, c) => s + c.poids, 0) / total) * 100) : null;
  const actions = audit.controles
    .filter((c) => c.ok === false)
    .sort((a, b) => b.poids - a.poids)
    .map((c) => ({ cle: c.cle, texte: CONTROLES.find((x) => x.cle === c.cle).action }))
    .slice(0, maxActions);
  return { note, actions };
}

// Semaine ISO (AAAA-Wnn) d'une date AAAA-MM-JJ.
export function semaineDe(jour) {
  const d = new Date(jour + 'T12:00:00Z');
  const j = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - j);
  const y = d.getUTCFullYear();
  return `${y}-W${String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

// Range le compte rendu dans le projet (26 semaines), avec la même transaction versionnée que le reste.
function ranger(db, projet, entree) {
  const key = 'project:' + projet;
  for (let i = 0; i < 5; i++) {
    const cur = db.getDoc(key);
    if (!cur) return null;
    const doc = JSON.parse(cur.value);
    const avant = (doc.seo || []).find((x) => x.semaine !== entree.semaine) || null;
    doc.seo = [entree, ...(doc.seo || []).filter((x) => x.semaine !== entree.semaine)].slice(0, 26);
    if (db.putDoc(key, JSON.stringify(doc), cur.version, 'agent:seo').ok) return avant;
  }
  return null;
}

export function createSeo({ db, dataDir, notify = async () => {}, fetchImpl = globalThis.fetch, now = () => Date.now(), jour = 0, heure = 8, sites = SITES_SEO, log = console }) {
  const stateFile = join(dataDir, 'seo-etat.json');
  async function derniere() {
    try {
      return JSON.parse(await readFile(stateFile, 'utf8')).semaine;
    } catch {
      return null;
    }
  }
  // Un passage : audite chaque site, range, et envoie un seul résumé. force = même hors du dimanche.
  async function passage({ force = false } = {}) {
    const t = now();
    const today = parisDate(t);
    const semaine = semaineDe(today);
    const estLeJour = new Date(today + 'T12:00:00Z').getUTCDay() === jour && parisHour(t) >= heure;
    if (!force && (!estLeJour || (await derniere()) === semaine)) return null;
    const lignes = [];
    for (const s of sites) {
      const audit = await auditerSite(s.site, { fetch: fetchImpl });
      const { note, actions } = noter(audit);
      const entree = { semaine, date: today, site: s.site, note, ms: audit.ms, statut: audit.statut, controles: audit.controles.map(({ cle, nom, poids, ok }) => ({ cle, nom, poids, ok })), actions, sitemap: audit.sitemap };
      const avant = ranger(db, s.projet, entree);
      const diff = avant && avant.note != null && note != null ? note - avant.note : null;
      lignes.push(`• ${s.site.replace('https://', '')} : ${note == null ? 'indisponible' : note + '/100'}${diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}${actions[0] ? ` — à faire d'abord : ${actions[0].texte}` : ''}`);
    }
    await writeFile(stateFile + '.tmp', JSON.stringify({ semaine, at: new Date(t).toISOString() }));
    await rename(stateFile + '.tmp', stateFile);
    await notify(`🔎 SEO de la semaine\n${lignes.join('\n')}\nLe détail et toutes les actions sont dans chaque projet ; les agents peuvent les proposer.`);
    return lignes;
  }
  let running = null;
  function safe(opts) {
    if (!running)
      running = passage(opts)
        .catch((e) => (log.error('seo', String(e.message || e)), null))
        .finally(() => (running = null));
    return running;
  }
  function start(everyMs = 30 * 60 * 1000) {
    const t = setInterval(() => safe(), everyMs);
    t.unref();
    return () => clearInterval(t);
  }
  return { passage, safe, start };
}
