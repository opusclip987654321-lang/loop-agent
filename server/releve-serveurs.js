// Relevé chiffré des autres projets qui tournent sur le serveur de Nūr (demande de Walid du
// 10/11/2026 : « branche tout en automatique »). Le programme horaire de ce serveur
// (scripts/nour-meet-releve.py) demande à chaque projet ses chiffres du jour — chaque projet les
// calcule lui-même, avec son propre code — et les joint à son envoi (POST /releve/nour-meet, même
// jeton). Loop Agent ne reçoit QUE des nombres et des dates, et remplit les indicateurs validés :
//   Impacteur Sponsors : mails envoyés, réponses positives, rendez-vous ou appels, secteurs, sponsors signés ;
//   Leviaro            : premiers mails, réponses humaines, intéressés et rendez-vous, dossiers
//                        envoyables, clients signés, taux de réponse aux premiers mails (30 jours).
// Une clé absente = donnée indisponible : l'indicateur n'est pas touché (jamais de 0 inventé).
// Pour un jour donné, la mesure du relevé remplace celle qu'un agent avait recopiée à la main.

const SOURCE = 'releve-serveur';
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const CLE = /^[a-z][a-z0-9_]{0,39}$/;
const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

// Pour chaque projet : d'où vient le chiffre, et quel indicateur (reconnu par son nom) reçoit quelle clé.
export const PLANS = {
  'impacteur-sponsors': {
    origine: 'Serveur Impacteur Sponsors (stock de prospection), relevé automatique chaque heure',
    jours: [
      { cle: 'mails_envoyes', motif: /mails? envoy/i, note: (v) => `${v} mail(s) de prospection parti(s) ce jour-là.` },
      { cle: 'reponses_positives', motif: /réponses? positives?/i, note: (v) => `${v} réponse(s) positive(s) reçue(s) ce jour-là.` },
      { cle: 'rdv', motif: /rendez-vous|appels? obtenu/i, note: (v) => `${v} rendez-vous ou appel(s) obtenu(s) ce jour-là.` },
      { cle: 'secteurs', motif: /secteur/i, note: (v) => `${v} secteur(s) différent(s) prospecté(s) ce jour-là.` },
      { cle: 'sponsors_signes', motif: /sponsors? sign/i, note: (v) => `${v} sponsor(s) signé(s) ce jour-là.` },
    ],
  },
  leviaro: {
    origine: 'Agent Leviaro (base de prospection), relevé automatique chaque heure',
    jours: [
      { cle: 'premiers_mails', motif: /premiers mails/i, sauf: /taux/i, note: (v) => `${v} premier(s) mail(s) envoyé(s) ce jour-là (relances non comptées).` },
      { cle: 'reponses_humaines', motif: /réponses? humaines?/i, note: (v) => `${v} réponse(s) humaine(s) reçue(s) ce jour-là.` },
      { cle: 'interesses_rdv', motif: /intéress/i, note: (v) => `${v} prospect(s) intéressé(s) ou rendez-vous ce jour-là.` },
      { cle: 'dossiers_envoyables', motif: /dossiers? envoyables?/i, note: (v) => `${v} dossier(s) noté(s) 75 ou plus produit(s) ce jour-là.` },
      { cle: 'clients_signes', motif: /clients? sign/i, note: (v) => `${v} client(s) signé(s) ce jour-là.` },
    ],
    // Taux sur 30 jours glissants, noté à la date du relevé. Sans premier mail sur la période : pas de mesure.
    taux: [{ motif: /taux de réponse/i, num: 'reponses_humaines_30j', den: 'premiers_mails_30j', note: (a, b) => `${a} réponse(s) humaine(s) pour ${b} premier(s) mail(s) sur 30 jours.` }],
  },
};

// Ne garde que les projets connus, des dates, des clés simples et des nombres : rien d'autre n'entre.
export function nettoyerProjets(projets) {
  const out = {};
  if (!projets || typeof projets !== 'object') return out;
  for (const id of Object.keys(PLANS)) {
    const p = projets[id];
    if (!p || typeof p !== 'object') continue;
    const jours = {};
    for (const [d, s] of Object.entries(p.jours && typeof p.jours === 'object' ? p.jours : {}).sort().slice(-200)) {
      if (!JOUR.test(d) || !s || typeof s !== 'object') continue;
      const propre = {};
      for (const [k, v] of Object.entries(s).slice(0, 30)) if (CLE.test(k) && n(v) !== null) propre[k] = n(v);
      jours[d] = propre;
    }
    const etat = {};
    for (const [k, v] of Object.entries(p.etat && typeof p.etat === 'object' ? p.etat : {}).slice(0, 30)) if (CLE.test(k) && n(v) !== null) etat[k] = n(v);
    if (Object.keys(jours).length || Object.keys(etat).length) out[id] = { jours, etat };
  }
  return out;
}

// Applique le relevé d'un projet à son document (fonction pure, testée seule).
export function appliquerProjet(doc, plan, releve, aujourdhui, nowIso) {
  const kpis = (doc.kpis || []).filter((k) => k.status === 'valide');
  doc.kpiValues = doc.kpiValues || [];
  const ecrits = [];
  const poser = (kpi, date, value, note) => {
    doc.kpiValues = doc.kpiValues.filter((v) => !(v.kpi === kpi.id && v.date === date));
    doc.kpiValues.unshift({ id: 'srv-' + kpi.id.slice(-6) + '-' + date, kpi: kpi.id, date, at: nowIso, source: SOURCE, origin: plan.origine, note, value });
    ecrits.push(kpi.name + ' ' + date);
  };
  for (const regle of plan.jours || []) {
    const kpi = kpis.find((k) => regle.motif.test(k.name) && !(regle.sauf && regle.sauf.test(k.name)));
    if (!kpi) continue;
    for (const [d, s] of Object.entries(releve.jours || {})) if (s[regle.cle] !== undefined) poser(kpi, d, s[regle.cle], regle.note(s[regle.cle]));
  }
  for (const regle of plan.taux || []) {
    const kpi = kpis.find((k) => regle.motif.test(k.name));
    const a = (releve.etat || {})[regle.num];
    const b = (releve.etat || {})[regle.den];
    if (!kpi || a === undefined || !b) continue;
    poser(kpi, aujourdhui, Math.round((a / b) * 1000) / 10, regle.note(a, b));
  }
  doc.kpiValues = doc.kpiValues.slice(0, 4000);
  return ecrits;
}

// Écrit chaque projet avec la même transaction versionnée que le reste (rien n'est écrasé).
// Un projet absent de la base ou occupé n'empêche pas les autres d'être enregistrés.
export function enregistrerProjets(db, projets, { aujourdhui, now = () => new Date().toISOString() } = {}) {
  const ecrits = [];
  for (const [id, releve] of Object.entries(projets || {})) {
    const plan = PLANS[id];
    if (!plan) continue;
    const key = 'project:' + id;
    for (let i = 0; i < 5; i++) {
      const cur = db.getDoc(key);
      if (!cur) break;
      const doc = JSON.parse(cur.value);
      const e = appliquerProjet(doc, plan, releve, aujourdhui, now());
      if (!e.length) break;
      if (db.putDoc(key, JSON.stringify(doc), cur.version, 'agent:releve-serveur').ok) {
        ecrits.push(...e);
        break;
      }
    }
  }
  return ecrits;
}
