// Relevé de la prospection Nūr Meet, envoyé chaque heure par un petit programme sur le
// serveur de Nūr (scripts/nour-meet-releve.py), qui lit les tableaux n8n np_* avec la clé
// n8n restée sur ce serveur. Loop Agent ne reçoit QUE des chiffres (aucun nom, aucune adresse).
// Il les range dans le projet « nourmeet » et remplit les indicateurs validés :
//   « …contact… »   (somme)   = premiers mails envoyés ce jour-là ;
//   « …ouverture… » (dernier) = taux d'ouverture des mails envoyés sur 7 jours glissants.
// Une nouvelle mesure du même jour REMPLACE la précédente venue du relevé (pas de double compte).
// Accès : POST /releve/nour-meet, en-tête Authorization: Bearer <jeton> ; seule l'empreinte du
// jeton est gardée (DATA_DIR/releve-nour.json, droits 600), créée par scripts/releve-jeton.js.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { nettoyerReponses, nettoyerMesReponses } from './reponses-nour.js';
import { nettoyerDonnees } from './nour-revue.js';

export const ROUTE = '/releve/nour-meet';
const SOURCE = 'releve-n8n';
const ORIGIN = 'n8n Nūr Meet (tableaux np_envois et np_ouvertures), relevé automatique chaque heure';
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const empreinte = (t) => createHash('sha256').update(String(t)).digest('hex');

export function jetonValide(dataDir, header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || ''));
  if (!m) return false;
  let conf;
  try {
    conf = JSON.parse(readFileSync(join(dataDir, 'releve-nour.json'), 'utf8'));
  } catch {
    return false;
  }
  const a = Buffer.from(empreinte(m[1]));
  const b = Buffer.from(String(conf.empreinte || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);

// Ne garde que des nombres : rien d'autre ne peut entrer.
export function nettoyer(body) {
  if (!body || typeof body !== 'object' || !body.jours || typeof body.jours !== 'object') throw new Error('Format attendu : { jours: { "AAAA-MM-JJ": {…} }, glissant7: {…} }');
  const jours = {};
  for (const [d, s] of Object.entries(body.jours).sort().slice(-120)) {
    if (!JOUR.test(d) || !s || typeof s !== 'object') continue;
    const versions = {};
    for (const [v, c] of Object.entries(s.versions || {}).slice(0, 20)) if (/^v\d{1,3}$/.test(v) && n(c) !== null) versions[v] = n(c);
    jours[d] = {
      premiers: n(s.premiers),
      relances: n(s.relances),
      echecs: n(s.echecs),
      ouvertures: n(s.ouvertures),
      reponses: n(s.reponses),
      decouverts: n(s.decouverts),
      inscriptions: s.inscriptions === undefined ? null : n(s.inscriptions),
      envoyes7: s.envoyes7 === undefined ? null : n(s.envoyes7),
      ouverts7: s.ouverts7 === undefined ? null : n(s.ouverts7),
      versions,
    };
  }
  if (!Object.keys(jours).length) throw new Error('Aucun jour valable.');
  const g = body.glissant7 || {};
  const glissant7 = { envoyes: n(g.envoyes), ouverts: n(g.ouverts) };
  const r = body.restaurants && typeof body.restaurants === 'object' ? { total: n(body.restaurants.total), abonnes: n(body.restaurants.abonnes) } : null;
  return { jours, glissant7, restaurants: r, reponses: nettoyerReponses(body.reponses), mesReponses: nettoyerMesReponses(body.mes_reponses), revue: nettoyerDonnees(body.revue) };
}

// Applique le relevé au document du projet (fonction pure, testée seule).
export function appliquer(doc, releve, nowIso) {
  doc.releveN8n = doc.releveN8n || { jours: {} };
  for (const [d, s] of Object.entries(releve.jours)) doc.releveN8n.jours[d] = s;
  const garder = Object.keys(doc.releveN8n.jours).sort().slice(-400);
  doc.releveN8n.jours = Object.fromEntries(garder.map((d) => [d, doc.releveN8n.jours[d]]));
  doc.releveN8n.glissant7 = releve.glissant7;
  doc.releveN8n.maj = nowIso;

  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  const contact = kpis.find((k) => /contact/i.test(k.name));
  const ouverture = kpis.find((k) => /ouverture/i.test(k.name));
  const inscriptions = kpis.find((k) => /inscription/i.test(k.name));
  const abonnes = kpis.find((k) => /abonn/i.test(k.name));
  const recues = kpis.find((k) => /réponses reçues/i.test(k.name));
  doc.kpiValues = doc.kpiValues || [];
  // Le relevé lit directement n8n : pour ce jour et cet indicateur, il remplace toute autre
  // mesure (celle d'un agent qui recopiait Notion, par exemple), sinon une somme compterait double.
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'rel-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: ORIGIN, note, value });
  };
  const ecrits = [];
  if (contact)
    for (const [d, s] of Object.entries(releve.jours))
      if (s.premiers !== null) {
        poser(contact, d, s.premiers, `${s.premiers} premier(s) mail(s) envoyé(s), ${s.relances ?? 0} relance(s), ${s.echecs ?? 0} échec(s).`);
        ecrits.push(contact.name + ' ' + d);
      }
  const g = releve.glissant7;
  // Rattrapage : le taux d'ouverture de chaque jour passé (7 jours finissant ce jour-là).
  if (ouverture)
    for (const [d, s] of Object.entries(releve.jours))
      if (s.envoyes7 && s.ouverts7 !== null) {
        poser(ouverture, d, Math.round((s.ouverts7 / s.envoyes7) * 1000) / 10, `${s.ouverts7} mail(s) ouvert(s) sur ${s.envoyes7} envoyé(s) sur les 7 jours finissant ce jour-là.`);
        ecrits.push(ouverture.name + ' ' + d);
      }
  if (ouverture && g.envoyes) {
    const aujourdhui = Object.keys(releve.jours).sort().pop();
    const taux = Math.round((g.ouverts / g.envoyes) * 1000) / 10;
    poser(ouverture, aujourdhui, taux, `${g.ouverts} mail(s) ouvert(s) sur ${g.envoyes} envoyé(s) ces 7 derniers jours.`);
    ecrits.push(ouverture.name + ' ' + aujourdhui);
  }
  if (recues)
    for (const [d, s] of Object.entries(releve.jours))
      if (s.reponses !== null) {
        poser(recues, d, s.reponses, `${s.reponses} réponse(s) de restaurant reçue(s) ce jour-là (toutes, avant tri).`);
        ecrits.push(recues.name + ' ' + d);
      }
  const ORIGIN_BASE = 'Base de l’application Nūr Meet (comptes restaurateurs hors démo, abonnements actifs), relevé automatique';
  if (inscriptions)
    for (const [d, s] of Object.entries(releve.jours))
      if (s.inscriptions !== null && s.inscriptions !== undefined) {
        poser(inscriptions, d, s.inscriptions, `${s.inscriptions} restaurant(s) inscrit(s) ce jour-là.`);
        doc.kpiValues[0].origin = ORIGIN_BASE;
        ecrits.push(inscriptions.name + ' ' + d);
      }
  if (abonnes && releve.restaurants && releve.restaurants.abonnes !== null) {
    const auj = Object.keys(releve.jours).sort().pop();
    poser(abonnes, auj, releve.restaurants.abonnes, `${releve.restaurants.abonnes} restaurant(s) abonné(s) sur ${releve.restaurants.total ?? '?'} inscrit(s) au total.`);
    doc.kpiValues[0].origin = ORIGIN_BASE;
    ecrits.push(abonnes.name + ' ' + auj);
  }
  doc.kpiValues = doc.kpiValues.slice(0, 4000);
  return ecrits;
}

// Écrit dans le projet avec la même transaction versionnée que le reste (rien n'est écrasé).
export function enregistrerReleve(db, releve, { project = 'nourmeet', now = () => new Date().toISOString() } = {}) {
  const key = 'project:' + project;
  for (let i = 0; i < 5; i++) {
    const cur = db.getDoc(key);
    if (!cur) throw new Error('Projet nourmeet introuvable.');
    const doc = JSON.parse(cur.value);
    const ecrits = appliquer(doc, releve, now());
    const r = db.putDoc(key, JSON.stringify(doc), cur.version, 'agent:releve-n8n');
    if (r.ok) return ecrits;
  }
  throw new Error('Document occupé, réessaie.');
}
