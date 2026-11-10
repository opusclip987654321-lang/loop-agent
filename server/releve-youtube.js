// Relevé YouTube de Petites Histoires Vraies (demande de Walid du 10/11/2026 : « branche tout en
// automatique »). Toutes les 3 heures, Loop Agent lit les deux flux PUBLICS de la chaîne (aucune
// clé, aucun compte : ce que n'importe quel lecteur de flux voit) :
//   - la liste des Shorts de la chaîne (15 derniers), avec date de publication et vues ;
//   - la liste des vidéos longues (15 dernières), avec date de publication.
// Il remplit les indicateurs validés du projet « petites-histoires » :
//   « …vidéos longue… »   (somme) = vidéos longues passées en public ce jour-là (heure de Paris) ;
//   « Shorts publiés »    (somme) = Shorts passés en public ce jour-là ;
//   « Vues des Shorts »   (somme) = vues gagnées ce jour-là par les 15 derniers Shorts.
// Les abonnés et les heures de visionnage ne sont PAS dans ces flux : ils demandent un accès au
// compte YouTube de la chaîne et restent relevés par l'agent tant que cet accès n'est pas branché.
// Une vidéo privée ou programmée n'apparaît pas : seul ce qui est réellement en ligne est compté.

import { parisDate } from './argent-rappels.js';

const SOURCE = 'releve-youtube';
const ORIGIN = 'YouTube, flux publics de la chaîne Petites Histoires Vraies (relevé automatique toutes les 3 heures)';
export const CHAINES = { 'petites-histoires': 'UCoTR63ZFhLWw11ZMUYGTR3w' };
// Listes fabriquées par YouTube pour chaque chaîne : « UUSH… » = ses Shorts, « UULF… » = ses vidéos longues.
export const fluxDe = (chaine) => ({
  shorts: `https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${chaine.slice(2)}`,
  longues: `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${chaine.slice(2)}`,
});
const PLEIN = 15; // un flux ne garde que les 15 dernières vidéos

// Lit un flux : seulement l'identifiant, la date de publication et les vues de chaque vidéo.
export function lireFlux(xml) {
  if (typeof xml !== 'string' || !xml.includes('<feed')) throw new Error('flux YouTube illisible');
  return xml
    .split('<entry>')
    .slice(1)
    .map((e) => {
      const id = (e.match(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/) || [])[1];
      const t = Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1] || '');
      const vues = (e.match(/<media:statistics views="(\d+)"/) || [])[1];
      return id && Number.isFinite(t) ? { id, publie: t, vues: vues === undefined ? null : Number(vues) } : null;
    })
    .filter(Boolean);
}

// Publications par jour de Paris, sur les `jours` derniers jours. Un flux plein (15 vidéos) ne dit
// rien des jours plus anciens que sa plus vieille vidéo, ni de ce jour-là en entier : ils sont laissés
// de côté (indisponible), jamais comptés à 0.
export function publicationsParJour(videos, aujourdhui, jours = 10) {
  const [a, m, j] = aujourdhui.split('-').map(Number);
  const fenetre = Array.from({ length: jours }, (_, i) => new Date(Date.UTC(a, m - 1, j - i)).toISOString().slice(0, 10));
  const parJour = {};
  for (const v of videos) parJour[parisDate(v.publie)] = (parJour[parisDate(v.publie)] || 0) + 1;
  const limite = videos.length >= PLEIN ? Object.keys(parJour).sort()[0] : null;
  return Object.fromEntries(fenetre.filter((d) => !limite || d > limite).map((d) => [d, parJour[d] || 0]));
}

// Applique le relevé au document du projet (fonction pure, testée seule).
export function appliquer(doc, { shorts, longues }, aujourdhui, nowIso) {
  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  const kLongues = kpis.find((k) => /vidéos? longues?/i.test(k.name));
  const kShorts = kpis.find((k) => /shorts? publi/i.test(k.name));
  const kVues = kpis.find((k) => /vues des shorts/i.test(k.name));
  doc.kpiValues = doc.kpiValues || [];
  const ecrits = [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'yt-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: ORIGIN, note, value });
    ecrits.push(kpi.name + ' ' + date);
  };
  if (kLongues) for (const [d, nb] of Object.entries(publicationsParJour(longues, aujourdhui))) poser(kLongues, d, nb, `${nb} vidéo(s) longue(s) passée(s) en public ce jour-là.`);
  if (kShorts) for (const [d, nb] of Object.entries(publicationsParJour(shorts, aujourdhui))) poser(kShorts, d, nb, `${nb} Short(s) passé(s) en public ce jour-là.`);

  // Vues gagnées dans la journée : vues de maintenant moins celles relevées à la fin de la veille.
  // Le tout premier jour il n'y a pas de point de départ : pas de mesure (indisponible, jamais 0).
  const vuesMaintenant = Object.fromEntries(shorts.filter((v) => v.vues !== null).map((v) => [v.id, v.vues]));
  const etat = doc.releveYoutube || {};
  let depart = etat.depart;
  let jourDepart = etat.jourDepart;
  if (etat.jour && etat.jour !== aujourdhui) {
    // Changement de jour : le dernier relevé de la veille devient le point de départ.
    depart = etat.dernier || {};
    jourDepart = aujourdhui;
  }
  if (kVues && depart && jourDepart === aujourdhui && Object.keys(vuesMaintenant).length) {
    let gagnees = 0;
    for (const v of shorts) {
      if (v.vues === null) continue;
      // Un Short publié aujourd'hui part de zéro ; un Short plus ancien inconnu la veille n'a pas de point de départ.
      const avant = depart[v.id] !== undefined ? depart[v.id] : parisDate(v.publie) === aujourdhui ? 0 : null;
      if (avant !== null) gagnees += Math.max(0, v.vues - avant);
    }
    poser(kVues, aujourdhui, gagnees, `${gagnees} vue(s) gagnée(s) ce jour-là par les ${shorts.length} derniers Shorts.`);
  }
  if (Object.keys(vuesMaintenant).length) doc.releveYoutube = { jour: aujourdhui, dernier: vuesMaintenant, depart, jourDepart, maj: nowIso };
  doc.kpiValues = doc.kpiValues.slice(0, 4000);
  return ecrits;
}

export function createReleveYoutube({ db, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, chaines = CHAINES }) {
  async function lire(url) {
    const r = await fetchImpl(url, { headers: { 'user-agent': 'Loop Agent - releve YouTube' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`YouTube répond ${r.status}`);
    return lireFlux(await r.text());
  }
  async function tick() {
    const bilan = {};
    for (const [projet, chaine] of Object.entries(chaines)) {
      const key = 'project:' + projet;
      if (!db.getDoc(key)) continue;
      const flux = fluxDe(chaine);
      const releve = { shorts: await lire(flux.shorts), longues: await lire(flux.longues) };
      const t = now();
      for (let i = 0; i < 5; i++) {
        const cur = db.getDoc(key);
        const doc = JSON.parse(cur.value);
        const ecrits = appliquer(doc, releve, parisDate(t), new Date(t).toISOString());
        if (db.putDoc(key, JSON.stringify(doc), cur.version, 'agent:releve-youtube').ok) {
          bilan[projet] = ecrits;
          break;
        }
      }
    }
    return bilan;
  }
  function start(everyMs = 3 * 60 * 60 * 1000) {
    const run = () => tick().catch((e) => log.error('relevé YouTube', String(e.message || e)));
    const first = setTimeout(run, 150000);
    const timer = setInterval(run, everyMs);
    first.unref();
    timer.unref();
    return () => (clearTimeout(first), clearInterval(timer));
  }
  return { tick, start };
}
