// Récap Telegram groupé : un seul message par tour d'agent.
// Chaque écriture d'un agent ajoute une ligne en attente (gardée dans la base,
// donc rien n'est perdu si le serveur redémarre). Quand un agent n'a plus rien
// écrit depuis `quietMs`, son tour est considéré fini : ses lignes partent en un
// message, puis sont effacées. Si Telegram ne répond pas, on réessaie plus tard.
//
// Sans TELEGRAM_BOT_TOKEN ni TELEGRAM_CHAT_ID, rien n'est noté ni envoyé.

const MAX_LINE = 220;
const MAX_MESSAGE = 3800; // Telegram coupe à 4096 caractères.

function short(s, max = MAX_LINE) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Ligne lisible (et drapeau « attend Walid ») pour un appel d'outil réussi.
export function describeEvent(tool, args = {}) {
  switch (tool) {
    case 'ecrire_tour':
      return args.premier_tour
        ? { line: `🔴 Premier résultat à valider sur ${args.action} : ${short(args.constat)}`, needsOk: true }
        : { line: `▸ ${args.action} : ${short(args.constat)}`, needsOk: false };
    case 'proposer_action':
      return { line: `🔴 Nouvelle action à valider : ${short(args.titre, 120)}`, needsOk: true };
    case 'proposer_modification':
      return { line: `🔴 Modification à valider sur ${args.action} (action arrêtée en attendant)`, needsOk: true };
    case 'proposer_idee':
      return { line: `🔴 Idée à valider sur ${args.action} : ${short(args.texte, 160)}`, needsOk: true };
    case 'noter_lecon':
      return { line: `📒 Leçon : ${short(args.titre, 120)}`, needsOk: false };
    case 'changer_statut_lecon':
      return { line: `📒 Leçon ${args.lecon} → ${args.statut}`, needsOk: false };
    case 'signaler_acces':
      return args.branche === true
        ? { line: `🟢 Accès branché : ${short(args.outil, 80)}`, needsOk: false }
        : { line: `🔴 Accès à brancher : ${short(args.outil, 80)}`, needsOk: true };
    case 'enregistrer_resultat':
      return {
        line: `📊 ${args.action} : ${
          args.indisponible === true ? 'donnée indisponible' : args.valeur !== undefined ? 'résultat ' + args.valeur : args.fait !== undefined ? (args.fait ? 'fait' : 'pas fait') : '+' + args.volume
        } (${short(args.d_ou, 60)})`,
        needsOk: false,
      };
    case 'proposer_indicateur':
      return { line: `🔴 Indicateur à valider : ${short(args.nom, 100)}`, needsOk: true };
    case 'ecrire_bilan':
      return { line: `📈 Bilan ${args.periode_type} ${args.periode} écrit`, needsOk: false };
    case 'enregistrer_depense':
      return { line: `💶 Dépense notée : ${short(args.nom, 80)} — ${args.montant} ${args.devise || ''} / ${args.frequence || ''}${args.estimation ? ' (estimation)' : ''}`, needsOk: false };
    case 'enregistrer_facture':
      return { line: `🧾 Facture traitée (${args.etat || 'lue'})${args.fournisseur ? ' : ' + short(args.fournisseur, 60) : ''}`, needsOk: false };
    default:
      return null;
  }
}

export function buildMessage(agentLabel, rows, siteUrl) {
  const waiting = rows.filter((r) => r.needs_ok).length;
  const head = `🔁 ${agentLabel} — tour terminé` + (waiting ? `\n⚠️ ${waiting} point(s) attendent ta validation` : '');
  const lines = [];
  let size = head.length;
  for (const r of rows) {
    if (size + r.line.length + 1 > MAX_MESSAGE - 120) {
      lines.push(`… et ${rows.length - lines.length} autre(s) ligne(s) dans Loop Agent.`);
      break;
    }
    lines.push(r.line);
    size += r.line.length + 1;
  }
  return [head, '', ...lines, ...(siteUrl ? ['', siteUrl] : [])].join('\n');
}

export function createNotifier({
  db,
  token,
  chatId,
  siteUrl = '',
  quietMs = 3 * 60 * 1000,
  labelFor = (agent) => agent,
  fetchImpl = globalThis.fetch,
  log = console,
}) {
  const enabled = Boolean(token && chatId);
  let sending = false;

  function note(agent, tool, args) {
    if (!enabled) return;
    const ev = describeEvent(tool, args);
    if (!ev) return;
    db.addNotice(agent, ev.line, ev.needsOk);
  }

  async function send(text) {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error('Telegram a répondu ' + r.status);
  }

  // Envoie les tours terminés. Renvoie le nombre de messages envoyés.
  async function flush(now = Date.now()) {
    if (!enabled || sending) return 0;
    sending = true;
    let sent = 0;
    try {
      const cutoff = new Date(now - quietMs).toISOString();
      for (const agent of db.quietNoticeAgents(cutoff)) {
        const rows = db.noticesFor(agent);
        if (!rows.length) continue;
        try {
          await send(buildMessage(labelFor(agent), rows, siteUrl));
          db.deleteNotices(rows.map((r) => r.id));
          sent++;
        } catch (e) {
          log.error(new Date().toISOString(), 'telegram', agent, String(e.message || e));
        }
      }
    } finally {
      sending = false;
    }
    return sent;
  }

  function start(everyMs = 30_000) {
    if (!enabled) return () => {};
    const t = setInterval(() => flush().catch(() => {}), everyMs);
    t.unref();
    return () => clearInterval(t);
  }

  return { enabled, note, flush, start, send };
}
