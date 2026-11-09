// Relance des agents après une décision de Walid.
// Quand Walid valide, refuse ou répond dans Loop Agent, le serveur lance la
// routine Claude du projet (déclencheur « API » d'une routine claude.ai/code),
// au plus une fois toutes les 30 minutes par projet. Une décision prise pendant
// ce délai n'est pas perdue : la routine part à la fin du délai.
//
// Les adresses et jetons des routines vivent dans DATA_DIR/routines.json
// (droits 600), rangés par « npm run routine-jeton » : jamais dans le code.
// Le tour lancé consomme l'abonnement Claude, pas l'API.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIRE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/;
const MAX_TEXT = 4000;

function short(s, max = 90) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
function parse(v) {
  if (!v) return {};
  try {
    const d = typeof v === 'string' ? JSON.parse(v) : v;
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}
const byId = (arr) => new Map((Array.isArray(arr) ? arr : []).filter((x) => x && x.id).map((x) => [x.id, x]));

// Ce que Walid vient de décider entre deux versions d'un projet.
export function decisionsBetween(oldValue, newValue) {
  const a = parse(oldValue),
    b = parse(newValue);
  const out = [];
  const oldTasks = byId(a.tasks);
  for (const t of Array.isArray(b.tasks) ? b.tasks : []) {
    if (!t || !t.id) continue;
    const name = short(t.title || t.name || t.id, 70);
    const o = oldTasks.get(t.id);
    if (!o) {
      if (t.firstRunPending || t.origin === 'Walid') out.push(`nouvelle action ajoutée : « ${name} »`);
      continue;
    }
    if (o.proposalStatus === 'pending' && t.proposalStatus !== 'pending')
      out.push(`proposition « ${name} » : ${t.proposalStatus === 'rejected' ? 'refusée' : 'validée'}`);
    if (o.stopped && !t.stopped) out.push(`modification de « ${name} » tranchée, l'action repart`);
    if (o.firstRunPending && !t.firstRunPending) out.push(`premier résultat de « ${name} » validé`);
    if (o.status === 'En attente de validation Walid' && t.status !== 'En attente de validation Walid')
      out.push(`« ${name} » : ${t.status || 'décidée'}`);
    if ((o.paused && !t.paused) || (o.status === 'En pause' && t.status !== 'En pause')) out.push(`« ${name} » reprend après la pause`);
    const oldDem = new Map((Array.isArray(o.demandes) ? o.demandes : []).map((d) => [d.id, d]));
    for (const d of Array.isArray(t.demandes) ? t.demandes : []) {
      const before = oldDem.get(d.id);
      if (before && before.statut === 'ouverte' && d.statut !== 'ouverte')
        out.push(`demande « ${short(d.texte, 80)} » sur « ${name} » : ${d.statut === 'faite' ? 'faite' : 'plus besoin'}${d.reponse ? ` (réponse de Walid : « ${short(d.reponse, 160)} »)` : ''}`);
    }
    const oldIdeas = Array.isArray(o.ideas) ? o.ideas : [];
    (Array.isArray(t.ideas) ? t.ideas : []).forEach((idea, i) => {
      if (!idea || typeof idea !== 'object') return;
      const before = oldIdeas.find((x) => x && typeof x === 'object' && idea.id && x.id === idea.id) || oldIdeas[i] || {};
      const label = short(idea.text || idea.title, 60);
      if (before.approvalStatus === 'pending' && idea.approvalStatus && idea.approvalStatus !== 'pending')
        out.push(`idée « ${label} » sur « ${name} » : ${idea.approvalStatus === 'approved' ? 'validée' : 'refusée'}`);
      if (idea.walidReply && idea.walidReply !== before.walidReply) out.push(`réponse de Walid sur l'idée « ${label} » (« ${name} »)`);
    });
  }
  const oldKpis = byId(a.kpis);
  for (const k of Array.isArray(b.kpis) ? b.kpis : []) {
    const o = k && oldKpis.get(k.id);
    if (o && o.status === 'propose' && k.status !== 'propose')
      out.push(`indicateur « ${short(k.name, 60)} » : ${k.status === 'valide' ? 'validé' : 'refusé'}`);
  }
  return out;
}

export function loadRoutines(dataDir, log = console) {
  const file = join(dataDir, 'routines.json');
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const ok = {};
    for (const [project, r] of Object.entries(raw || {})) {
      if (r && FIRE_URL.test(String(r.url)) && /^sk-ant-oat01-\S+$/.test(String(r.token))) ok[project] = { url: r.url, token: r.token };
      else log.error('routines.json : entrée ignorée pour', project, '(adresse ou jeton mal formé)');
    }
    return ok;
  } catch (e) {
    log.error('routines.json illisible :', String(e.message || e));
    return {};
  }
}

export function createRoutineRelay({
  dataDir,
  cooldownMs = 30 * 60 * 1000,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  notify = async () => {},
  labelFor = (p) => p,
  log = console,
  reminderQuietMs = 3 * 60 * 1000,
  routines = null,
}) {
  const getRoutines = () => routines || loadRoutines(dataDir, log);
  const lastFire = new Map(); // projet → horodatage du dernier lancement
  const pending = new Map(); // projet → décisions en attente de lancement
  const blockedUntil = new Map(); // projet → fin d'un refus 429
  // Projets sans routine (agent en conversation sur le Mac) : un rappel Telegram groupé,
  // envoyé quand Walid n’a plus rien décidé sur ce projet depuis `reminderQuietMs`.
  const reminders = new Map(); // projet → { decisions, at }

  function noteDecisions(project, decisions) {
    if (!decisions.length) return false;
    if (!getRoutines()[project]) {
      const r = reminders.get(project) || { decisions: [] };
      reminders.set(project, { decisions: [...r.decisions, ...decisions], at: now() });
      return false;
    }
    pending.set(project, [...(pending.get(project) || []), ...decisions]);
    return true;
  }

  function onWalidSave(key, oldValue, newValue) {
    const m = /^project:(.+)$/.exec(key);
    if (!m) return false;
    const queued = noteDecisions(m[1], decisionsBetween(oldValue, newValue));
    if (queued) tick().catch(() => {});
    return queued;
  }

  async function fire(project, decisions) {
    const r = getRoutines()[project];
    if (!r) return { ok: false, reason: 'pas de routine' };
    const text = short(
      `Walid vient de décider dans Loop Agent (projet ${labelFor(project)}) :\n- ${decisions.join('\n- ')}\n\n` +
        'Commence par lire_projet, puis fais tourner ce qui est validé, en suivant les consignes du connecteur.',
      MAX_TEXT,
    );
    const res = await fetchImpl(r.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r.token}`, 'anthropic-version': '2026-10-21', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 600;
      return { ok: false, retryAfterMs: wait * 1000, reason: 'limite horaire de Claude atteinte' };
    }
    if (!res.ok) return { ok: false, reason: `Claude a répondu ${res.status}`, fatal: res.status === 401 || res.status === 403 || res.status === 404 };
    const j = await res.json().catch(() => ({}));
    return { ok: true, url: j.claude_code_session_url || '' };
  }

  let inflight = null;
  function tick() {
    if (!inflight) inflight = run().finally(() => (inflight = null));
    return inflight;
  }
  async function run() {
    {
      for (const [project, r] of [...reminders]) {
        if (now() - r.at < reminderQuietMs) continue;
        reminders.delete(project);
        const list = r.decisions.slice(0, 8).map((d) => "- " + d).join("\n") + (r.decisions.length > 8 ? `\n… et ${r.decisions.length - 8} autre(s)` : "");
        await notify(`🔔 ${labelFor(project)} : tu as décidé dans Loop Agent, mais son agent ne peut pas être relancé automatiquement (il tourne en conversation). Écris-lui pour qu’il reparte.\n${list}`).catch(() => {});
      }
      for (const [project, decisions] of [...pending]) {
        const t = now();
        if (t < (blockedUntil.get(project) || 0)) continue;
        if (lastFire.has(project) && t - lastFire.get(project) < cooldownMs) continue;
        pending.delete(project);
        let r;
        try {
          r = await fire(project, decisions);
        } catch (e) {
          r = { ok: false, reason: String(e.message || e) };
        }
        const name = labelFor(project);
        if (r.ok) {
          lastFire.set(project, t);
          log.log(new Date(t).toISOString(), 'routine relancée', project);
          await notify(`▶️ ${name} : agent relancé après ta décision (${decisions.length} point(s)).${r.url ? '\n' + r.url : ''}`).catch(() => {});
        } else if (r.retryAfterMs) {
          blockedUntil.set(project, t + r.retryAfterMs);
          pending.set(project, [...decisions, ...(pending.get(project) || [])]);
          log.error('routine', project, r.reason);
        } else {
          log.error('routine', project, r.reason);
          await notify(`⚠️ ${name} : impossible de relancer l'agent (${r.reason}). Relance-le à la main.`).catch(() => {});
          if (!r.fatal) {
            lastFire.set(project, t); // réessai au prochain délai, pas en boucle
            pending.set(project, [...decisions, ...(pending.get(project) || [])]);
          }
        }
      }
    }
  }

  function start(everyMs = 60_000) {
    const t = setInterval(() => tick().catch(() => {}), everyMs);
    t.unref();
    return () => clearInterval(t);
  }

  return { onWalidSave, tick, start, pending, reminders, lastFire, decisionsBetween };
}
