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
  for (const [d, s] of Object.entries(body.jours).slice(0, 10)) {
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
      versions,
    };
  }
  if (!Object.keys(jours).length) throw new Error('Aucun jour valable.');
  const g = body.glissant7 || {};
  const glissant7 = { envoyes: n(g.envoyes), ouverts: n(g.ouverts) };
  return { jours, glissant7 };
}

// Applique le relevé au document du projet (fonction pure, testée seule).
export function appliquer(doc, releve, nowIso) {
  doc.releveN8n = doc.releveN8n || { jours: {} };
  for (const [d, s] of Object.entries(releve.jours)) doc.releveN8n.jours[d] = s;
  const garder = Object.keys(doc.releveN8n.jours).sort().slice(-90);
  doc.releveN8n.jours = Object.fromEntries(garder.map((d) => [d, doc.releveN8n.jours[d]]));
  doc.releveN8n.glissant7 = releve.glissant7;
  doc.releveN8n.maj = nowIso;

  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  const contact = kpis.find((k) => /contact/i.test(k.name));
  const ouverture = kpis.find((k) => /ouverture/i.test(k.name));
  doc.kpiValues = doc.kpiValues || [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date && v.source === SOURCE));
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
  if (ouverture && g.envoyes) {
    const aujourdhui = Object.keys(releve.jours).sort().pop();
    const taux = Math.round((g.ouverts / g.envoyes) * 1000) / 10;
    poser(ouverture, aujourdhui, taux, `${g.ouverts} mail(s) ouvert(s) sur ${g.envoyes} envoyé(s) ces 7 derniers jours.`);
    ecrits.push(ouverture.name + ' ' + aujourdhui);
  }
  doc.kpiValues = doc.kpiValues.slice(0, 2000);
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
