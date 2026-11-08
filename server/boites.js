// Mails urgents des 6 boîtes Gmail de Walid (reprise du cerveau central, src/boites.js).
// Chaque heure, Loop Agent appelle l'automatisation n8n « CERVEAU - lecture des boîtes »,
// qui renvoie les mails des 3 derniers jours (hors promotions, réseaux sociaux, forums)
// et ne fait rien d'autre (ni envoi, ni libellé, ni « lu »). Le tri se fait ici, par règles,
// SANS IA. Chaque mail urgent part une seule fois sur Telegram, groupé par passage.
// L'adresse secrète de l'automatisation est rangée dans DATA_DIR/boites.json (droits 600)
// par scripts/boites-adresse.js : jamais dans le code.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const BOITES = [
  { id: 'opusclip', adresse: 'opusclip987654321@gmail.com' },
  { id: 'walidvideos12', adresse: 'walidvideos12@gmail.com' },
  { id: 'impacteurmedia', adresse: 'impacteurmedia@gmail.com' },
  { id: 'gougamwalid', adresse: 'gougamwalid@gmail.com' },
  { id: 'impacteurfrexit', adresse: 'impacteurfrexit@gmail.com' },
  { id: 'impacteurafrique', adresse: 'impacteurafrique@gmail.com' },
];
export const WEBHOOK_RE = /^https:\/\/n8n\.nourmeet\.com\/webhook\/cerveau-boites-[0-9a-f]{32}$/;

const texte = (v) => (v == null ? '' : String(v));
const ADRESSES = BOITES.map((b) => b.adresse);
// Mêmes règles que le cerveau (src/boites.js).
const EXPEDITEUR_AUTO = /no-?reply|do-?not-?reply|donotreply|ne-?pas-?r[ée]pondre|mailer-?daemon|postmaster|notifications?@|notify@|alerts?@|news(letter)?@|marketing@|bounce/i;
const ALERTE = /alerte de s[ée]curit[ée]|security alert|connexion (suspecte|inhabituelle)|suspicious (sign-in|activity)|compte (a [ée]t[ée] )?(suspendu|d[ée]sactiv[ée]|bloqu[ée]|restreint|pirat[ée])|account (has been )?(suspended|disabled|restricted|locked|compromised)|violation|copyright|droits? d'auteur|avertissement|strike|r[ée]clamation|paiement (refus[ée]|[ée]chou[ée]|rejet[ée])|[ée]chec (du |de )?paiement|payment (failed|declined)|impay[ée]|past due|overdue|dernier rappel|final notice|mise en demeure|huissier|urssaf|imp[ôo]ts|amende|action (requise|required)/i;
const AFFAIRE = /devis|facture|commande|partenariat|sponsor|collaboration|contrat|proposition|rendez-vous|\brdv\b|entretien|interview|invitation|abonnement|paiement|virement|tarif|\bprix\b|urgent|asap|au plus vite|rapidement|relance/i;

export function classerMail(m) {
  const de = m.de.toLowerCase();
  if (ADRESSES.some((a) => de.includes(a))) return null;
  const contenu = `${m.objet} ${m.extrait}`;
  if (ALERTE.test(contenu)) return { niveau: 'urgent', raison: 'Compte ou paiement en danger' };
  if (EXPEDITEUR_AUTO.test(de)) return null;
  if (AFFAIRE.test(contenu)) return { niveau: 'urgent', raison: 'Une personne parle argent, contrat ou rendez-vous' };
  if (m.nonLu) return { niveau: 'a-traiter', raison: 'Une personne t’a écrit, pas encore lu' };
  return null;
}

// Transforme la réponse de n8n en { etat, mails } (mêmes champs que le cerveau).
export function lireReponse(rep) {
  const lignes = (Array.isArray(rep) ? rep : [rep]).filter((l) => l && l.boite);
  const etat = {};
  for (const b of BOITES) etat[b.id] = { lue: false, erreur: 'pas dans la réponse de n8n' };
  for (const l of lignes.filter((x) => !x.id)) etat[l.boite] = l.erreur ? { lue: false, erreur: texte(l.erreur).slice(0, 300) } : { lue: true, n: Number(l.lus) || 0 };
  const vus = new Set();
  const mails = lignes
    .filter((l) => l.id && etat[l.boite] && !vus.has(`${l.boite}:${l.id}`) && vus.add(`${l.boite}:${l.id}`))
    .map((l) => {
      const libelles = Array.isArray(l.labelIds) ? l.labelIds.map(String) : [];
      const date = l.date ?? (l.internalDate ? new Date(Number(l.internalDate)).toISOString() : null);
      return {
        boite: l.boite,
        id: texte(l.id),
        fil: texte(l.threadId || l.id),
        quand: date ? new Date(date).toISOString() : null,
        de: texte(l.From ?? l.from).slice(0, 120),
        objet: texte(l.Subject ?? l.subject).slice(0, 200),
        extrait: texte(l.snippet).slice(0, 300),
        nonLu: libelles.includes('UNREAD'),
      };
    })
    .map((m) => ({ ...m, ...classerMail(m) }))
    .filter((m) => m.niveau);
  return { etat, mails };
}

const nomCourt = (de) => (de.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? de).trim();
export const lienGmail = (m) => `https://mail.google.com/mail/?authuser=${BOITES.find((b) => b.id === m.boite)?.adresse ?? ''}#all/${m.fil}`;

export function messageUrgents(nouveaux, max = 5) {
  const lignes = nouveaux.slice(0, max).map((m) => `• ${nomCourt(m.de)} (${m.boite}) : ${m.objet || '(sans objet)'}\n  ${m.raison}\n  ${lienGmail(m)}`);
  const reste = nouveaux.length > max ? `\n… et ${nouveaux.length - max} autre(s).` : '';
  return `📬 ${nouveaux.length} mail(s) urgent(s) à traiter :\n${lignes.join('\n')}${reste}`;
}

export function createBoites({ dataDir, notify = async () => {}, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 90000, log = console }) {
  const confFile = join(dataDir, 'boites.json');
  const stateFile = join(dataDir, 'boites-etat.json');
  async function url() {
    try {
      const u = JSON.parse(await readFile(confFile, 'utf8')).url;
      return WEBHOOK_RE.test(u) ? u : null;
    } catch {
      return null;
    }
  }
  async function loadState() {
    try {
      return JSON.parse(await readFile(stateFile, 'utf8'));
    } catch {
      return { signales: {} };
    }
  }
  async function saveState(s) {
    const tmp = stateFile + '.tmp';
    await writeFile(tmp, JSON.stringify(s, null, 2));
    await rename(tmp, stateFile);
  }

  async function tick() {
    const u = await url();
    if (!u) return { ignore: true };
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`n8n répond ${res.status}`);
    const { etat, mails } = lireReponse(await res.json());
    const state = await loadState();
    state.signales = state.signales || {};
    const t = now();
    const enPanne = Object.entries(etat).filter(([, x]) => !x.lue).map(([id]) => id);
    const nouveaux = mails.filter((m) => m.niveau === 'urgent' && !state.signales[`${m.boite}:${m.id}`]);
    for (const m of nouveaux) state.signales[`${m.boite}:${m.id}`] = new Date(t).toISOString();
    for (const [k, q] of Object.entries(state.signales)) if (t - Date.parse(q) > 30 * 86400000) delete state.signales[k];
    // Toutes les boîtes muettes : une alerte par jour au plus, pas à chaque heure.
    const jour = new Date(t).toISOString().slice(0, 10);
    let panneMsg = null;
    if (enPanne.length === BOITES.length && state.panneSignalee !== jour) {
      panneMsg = `⚠️ Mails : aucune des 6 boîtes n’a pu être lue (${etat[enPanne[0]].erreur}). Vérifie l’automatisation n8n « CERVEAU - lecture des boîtes ».`;
      state.panneSignalee = jour;
    }
    state.dernierPassage = { at: new Date(t).toISOString(), lues: BOITES.length - enPanne.length, enPanne, urgents: mails.filter((m) => m.niveau === 'urgent').length, aTraiter: mails.filter((m) => m.niveau === 'a-traiter').length };
    state.mails = mails.slice(0, 40);
    await saveState(state);
    if (nouveaux.length) await notify(messageUrgents(nouveaux));
    if (panneMsg) await notify(panneMsg);
    return { nouveaux: nouveaux.length, ...state.dernierPassage };
  }

  let running = null;
  function safeTick() {
    if (!running)
      running = tick()
        .catch((e) => (log.error('boîtes mail', String(e.message || e)), null))
        .finally(() => (running = null));
    return running;
  }
  function start(everyMs = 60 * 60 * 1000) {
    const first = setTimeout(safeTick, 90000);
    const t = setInterval(safeTick, everyMs);
    first.unref();
    t.unref();
    return () => (clearTimeout(first), clearInterval(t));
  }
  return { tick, safeTick, start };
}
