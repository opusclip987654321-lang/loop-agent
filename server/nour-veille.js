// Veille quotidienne de la prospection Nūr Meet (demande de Walid du 09/11/2026 : « tu ne peux
// pas le programmer seul ? »). Chaque jour à partir de 11 h (Paris), Loop Agent regarde le relevé
// du jour (envoyé chaque heure par le serveur de Nūr) et prévient Walid sur Telegram seulement
// si quelque chose ne va pas :
//  - aucun mail parti ce matin (ni premier mail, ni relance) ;
//  - des mails partis avec une autre version que la méthode servie (n8n n'a pas lu la méthode
//    chez Loop Agent et est reparti sur ses anciens textes).
// Rien d'autre : ni message « tout va bien », ni alerte si le relevé manque (choix de Walid du 09/11).
// Une seule vérification par jour ; l'état est gardé dans DATA_DIR/nour-veille.json.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parisDate, parisHour } from './argent-rappels.js';
import { charger as chargerMethode } from './nour-methode.js';

export function verifierJour(releve, versionMethode, jour) {
  const s = releve && releve.jours && releve.jours[jour];
  if (!s) return { ok: true, texte: 'pas de relevé aujourd’hui (rien à signaler, choix de Walid du 09/11)' };
  const envoyes = (s.premiers || 0) + (s.relances || 0);
  if (!envoyes)
    return { ok: false, texte: `⚠️ Nūr Meet : aucun mail de prospection n’est parti ce matin (0 premier mail, 0 relance${s.echecs ? `, ${s.echecs} échec(s)` : ''}). Les automatisations n8n « Nour Meet 1 » et « Nour Meet 3 » ont peut-être un problème.` };
  const versions = Object.keys(s.versions || {});
  const attendue = versionMethode ? `v${versionMethode}` : null;
  const autres = attendue ? versions.filter((v) => v !== attendue) : [];
  if (attendue && autres.length)
    return {
      ok: false,
      texte: `⚠️ Nūr Meet : ${autres.map((v) => `${s.versions[v]} mail(s) en ${v}`).join(', ')} ce matin, alors que la méthode servie par Loop Agent est la ${attendue}. n8n n’a sans doute pas pu lire la méthode et est reparti sur ses anciens textes : vérifie l’adresse dans la case « LOOP - lire la méthode » de Nour Meet 1 et 3.`,
    };
  return { ok: true, texte: `${s.premiers} premier(s) mail(s) et ${s.relances} relance(s) ce matin${attendue ? `, méthode ${attendue}` : ''}` };
}

export function createNourVeille({ db, dataDir, notify = async () => {}, now = () => Date.now(), heure = 11, log = console }) {
  const file = join(dataDir, 'nour-veille.json');
  async function etat() {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return {};
    }
  }
  async function tick() {
    const t = now();
    const jour = parisDate(t);
    if (parisHour(t) < heure) return null;
    const e = await etat();
    if (e.dernier === jour) return null;
    const d = db.getDoc('project:nourmeet');
    const doc = d ? JSON.parse(d.value) : {};
    const m = chargerMethode(dataDir);
    const r = verifierJour(doc.releveN8n, m && m.methode ? m.methode.version : null, jour);
    if (!r.ok) await notify(r.texte);
    const suivant = { dernier: jour, resultat: r.ok ? 'ok' : r.texte };
    await writeFile(file + '.tmp', JSON.stringify(suivant));
    await rename(file + '.tmp', file);
    return r;
  }
  function start(everyMs = 15 * 60 * 1000) {
    const timer = setInterval(() => tick().catch((err) => log.error('veille Nūr Meet', String(err.message || err))), everyMs);
    timer.unref();
    return () => clearInterval(timer);
  }
  return { tick, start };
}
