// Relevé d'« Email interview Impacteur » (reprise du cerveau central, src/business.js).
// Chaque heure, Loop Agent appelle l'automatisation n8n « CERVEAU - lecture Impacteur », qui lit
// l'onglet Prospection du Google Sheet d'Impacteur (une fiche par invité : date d'envoi, date et
// type de réponse). Il remplit les indicateurs validés du projet « impacteur-mail » :
//   « …envoy… »     (somme)   = invitations envoyées ce jour-là ;
//   « …positi… »    (somme)   = réponses positives ce jour-là (OUI_INTERVIEW ou LIVRE_ACCEPTE) ;
//   « …interview… » (somme)   = interviews acceptées ce jour-là (OUI_INTERVIEW) ;
//   « …taux… »      (dernier) = part des invitations des 30 derniers jours qui ont eu une réponse.
// Seuls des nombres entrent dans Loop Agent : ni nom, ni livre, ni texte de mail.
// L'adresse secrète de l'automatisation est dans DATA_DIR/impacteur.json (droits 600).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parisDate } from './argent-rappels.js';

export const WEBHOOK_RE = /^https:\/\/n8n\.nourmeet\.com\/webhook\/cerveau-impacteur-[0-9a-f]{32}$/;
const SOURCE = 'releve-impacteur';
const ORIGIN = 'Google Sheet Impacteur, onglet Prospection, via n8n (relevé automatique chaque heure)';

// Même lecture des dates que le cerveau : « 07/11/2026 … », ISO, ou « 2026-11-07 09:00 ».
export function jourDe(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  const fr = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(' ', 'T') : t);
  return Number.isNaN(+d) ? null : parisDate(+d);
}

export function lireFiches(rep) {
  const lignes = (Array.isArray(rep) ? rep : [rep]).filter((l) => l && l.statut && l.statut !== 'CONFIG');
  return {
    fiches: lignes.map((l) => ({
      envoi: jourDe(l.date_envoi),
      reponse: jourDe(l.reponse_le),
      type: l.reponse_type ? String(l.reponse_type).trim().toUpperCase() : null,
    })),
    reponsesMesurees: lignes.some((l) => 'reponse_type' in l),
  };
}

export function appliquer(doc, lu, aujourdhui, nowIso) {
  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  const trouve = (re) => kpis.find((k) => re.test(k.name));
  const envoyes = trouve(/envoy/i);
  const positives = trouve(/positi/i);
  const interviews = trouve(/interview/i);
  const taux = trouve(/taux/i);
  doc.kpiValues = doc.kpiValues || [];
  const ecrits = [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'im-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: ORIGIN, note, value });
    ecrits.push(kpi.name + ' ' + date);
  };
  // Les 14 derniers jours, jour par jour.
  const debut = new Date(Date.parse(aujourdhui + 'T12:00:00Z') - 13 * 86400000).toISOString().slice(0, 10);
  const jours = [];
  for (let d = debut; d <= aujourdhui; d = new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) jours.push(d);
  const estPositive = (f) => f.type && (f.type.includes('OUI_INTERVIEW') || f.type.includes('LIVRE_ACCEPTE'));
  for (const d of jours) {
    if (envoyes) poser(envoyes, d, lu.fiches.filter((f) => f.envoi === d).length, 'Invitations envoyées ce jour-là.');
    if (lu.reponsesMesurees) {
      if (positives) poser(positives, d, lu.fiches.filter((f) => f.reponse === d && estPositive(f)).length, 'Réponses positives (interview ou livre accepté) ce jour-là.');
      if (interviews) poser(interviews, d, lu.fiches.filter((f) => f.reponse === d && f.type && f.type.includes('OUI_INTERVIEW')).length, 'Interviews acceptées ce jour-là.');
    }
  }
  if (taux && lu.reponsesMesurees) {
    const depuis = new Date(Date.parse(aujourdhui + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
    const env = lu.fiches.filter((f) => f.envoi && f.envoi >= depuis);
    if (env.length) {
      const rep = env.filter((f) => f.type && f.type !== 'A_CLASSER').length;
      poser(taux, aujourdhui, Math.round((rep / env.length) * 1000) / 10, `${rep} réponse(s) sur ${env.length} invitation(s) envoyée(s) ces 30 derniers jours.`);
    }
  }
  doc.kpiValues = doc.kpiValues.slice(0, 2000);
  return ecrits;
}

export function createReleveImpacteur({ db, dataDir, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
  function url() {
    try {
      const u = JSON.parse(readFileSync(join(dataDir, 'impacteur.json'), 'utf8')).url;
      return WEBHOOK_RE.test(u) ? u : null;
    } catch {
      return null;
    }
  }
  async function tick() {
    const u = url();
    if (!u) return { ignore: true };
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`n8n répond ${r.status}`);
    const lu = lireFiches(await r.json());
    const t = now();
    for (let i = 0; i < 5; i++) {
      const cur = db.getDoc('project:impacteur-mail');
      if (!cur) return { ignore: true };
      const doc = JSON.parse(cur.value);
      const ecrits = appliquer(doc, lu, parisDate(t), new Date(t).toISOString());
      if (db.putDoc('project:impacteur-mail', JSON.stringify(doc), cur.version, 'agent:releve-impacteur').ok) return { ecrits, fiches: lu.fiches.length };
    }
    throw new Error('document occupé');
  }
  function start(everyMs = 60 * 60 * 1000) {
    const run = () => tick().catch((e) => log.error('relevé Impacteur', String(e.message || e)));
    const first = setTimeout(run, 150000);
    const timer = setInterval(run, everyMs);
    first.unref();
    timer.unref();
    return () => (clearTimeout(first), clearInterval(timer));
  }
  return { tick, start };
}
