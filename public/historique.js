// Refus avec raison, départ du tableau des actions refusées, onglet Historique.
// Chargé après glue.js : les fonctions déclarées ici remplacent celles d'app.js.
//
// Règles (demandées par Walid le 07/11/2026) :
// - Refuser ouvre une case « pourquoi ? » (facultative). L'agent lit cette raison
//   et les réponses de Walid sur les idées de l'action.
// - Refusée sans raison ni réponse : elle quitte le tableau 2 jours après le refus.
// - Refusée avec raison ou réponse : elle reste jusqu'à ce que l'agent propose une
//   action corrigée (champ « remplace »), et au plus 7 jours.
// - Historique : seulement ce qui est fini — actions refusées et actions
//   ponctuelles terminées (une boucle ne se termine jamais : elle reste au
//   tableau). « Garder » ou « Lu, retirer » : retirer une action terminée
//   n'efface que sa ligne d'historique ; retirer une action refusée la supprime.
'use strict';

const HISTORY_SLUG = 'historique';
const DAY = 24 * 3600 * 1000;
let historyFilter = 'Toutes';

function hasWalidWords(t) {
  return !!(
    (t.rejectReason || '').trim() ||
    (t.ideas || []).some((i) => i && typeof i === 'object' && (i.walidReply || '').trim())
  );
}
function boardDeadline(t) {
  if (t.proposalStatus !== 'rejected') return null;
  const from = Date.parse(t.rejectedAt || t.decidedAt || '');
  if (!from) return null;
  return new Date(from + (hasWalidWords(t) ? 7 : 2) * DAY);
}
function leftBoard(t) {
  if (t.proposalStatus !== 'rejected') return false;
  if (t.supersededBy) return true;
  const d = boardDeadline(t);
  return !!d && Date.now() >= d.getTime();
}
function frDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
    ' à ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  );
}

// Une action refusée n'apparaît plus qu'en Planification, puis nulle part.
const baseStagesFor = stagesFor;
stagesFor = function (t) {
  if (t.proposalStatus === 'rejected') return leftBoard(t) ? [] : ['planification'];
  return baseStagesFor(t);
};

// Valider : comme avant, avec la date. Refuser : d'abord la raison.
setTaskProposal = function (id, approved) {
  const t = task(id);
  if (!t) return;
  if (!approved) {
    modal(
      'Refuser cette action',
      `<p><strong>${esc(t.title)}</strong></p><label for="rejectReason">Pourquoi ? <span class="note">(facultatif — l’agent le lira et pourra proposer une version corrigée)</span></label><textarea id="rejectReason" placeholder="Ex. : trop risqué pour le compte, pas prioritaire ce mois-ci, plutôt faire…"></textarea><p class="note">Sans raison ni commentaire, l’action quittera le tableau dans 2 jours. Avec une raison, elle reste jusqu’à la réponse de l’agent (7 jours au plus). Elle reste visible dans l’Historique.</p><div class="actions">${btn('❌ Refuser', `confirmReject('${t.id}')`, 'danger')}${btn('Annuler', 'closeDialog()')}</div>`,
    );
    setTimeout(() => document.getElementById('rejectReason')?.focus(), 50);
    return;
  }
  t.proposalStatus = 'approved';
  t.status = 'À planifier';
  t.decidedAt = new Date().toISOString();
  save();
  render();
  notify('Nouvelle action validée : l’IA peut la lancer quand elle le décide.');
};
function confirmReject(id) {
  const t = task(id);
  if (!t) return;
  const reason = (document.getElementById('rejectReason')?.value || '').trim().slice(0, 2000);
  const now = new Date().toISOString();
  t.proposalStatus = 'rejected';
  t.status = 'Action refusée par Walid';
  t.decidedAt = now;
  t.rejectedAt = now;
  t.rejectReason = reason;
  closeDialog();
  save();
  render();
  notify(reason ? 'Action refusée : l’agent lira ta raison au prochain tour.' : 'Action refusée : elle quittera le tableau dans 2 jours.');
}

// Bandeau sur la carte : proposition en attente, validée, ou refusée.
const baseProposalCard = proposalCard;
proposalCard = function (t) {
  if (t.proposalStatus !== 'rejected') return baseProposalCard(t);
  const d = boardDeadline(t);
  const words = hasWalidWords(t);
  return `<section class="strip"><strong>❌ Refusée par Walid</strong> <span class="note">le ${esc(frDate(t.rejectedAt || t.decidedAt))}</span>${
    t.rejectReason ? `<p>Raison : ${esc(t.rejectReason)}</p>` : ''
  }<p class="note">${
    t.supersededBy
      ? 'L’agent a proposé une version corrigée.'
      : words
        ? 'L’agent lira ta raison et tes commentaires au prochain tour, et pourra proposer une version corrigée.'
        : 'Aucune raison ni commentaire : l’agent ne la reproposera pas.'
  }${d ? ` Quitte le tableau le ${esc(frDate(d.toISOString()))}.` : ''}</p><div class="actions">${btn(
    'Changer la raison',
    `setTaskProposal('${t.id}',false)`,
  )}</div></section>`;
};

// ---------- Onglet Historique ----------
function historyItems() {
  return (data.tasks || [])
    .filter((t) => (t.proposalStatus === 'rejected' || t.done) && !t.historyHidden)
    .filter(
      (t) =>
        historyFilter === 'Toutes' ||
        (historyFilter === 'Terminées' && t.done && t.proposalStatus !== 'rejected') ||
        (historyFilter === 'Refusées' && t.proposalStatus === 'rejected') ||
        (historyFilter === 'Gardées' && t.historyKept),
    )
    .sort((a, b) => String(endDate(b) || '').localeCompare(String(endDate(a) || '')));
}
function endDate(t) {
  return t.proposalStatus === 'rejected' ? t.rejectedAt || t.decidedAt : t.doneAt || t.lastAgentTurn || t.decidedAt || t.proposedAt;
}
function historyCard(t) {
  const ok = t.proposalStatus !== 'rejected';
  const where = ok ? 'Terminée' : leftBoard(t) ? 'Retirée du tableau' : 'Encore au tableau';
  return `<article class="card ${ok ? 'cgreen' : 'cred'}"><div class="toolbar" style="margin:0 0 8px">${pill(
    ok ? 'Terminée' : 'Refusée',
  )}<span class="badge">${t.type === 'Boucle' ? '🔁 Boucle' : '● Ponctuelle'}</span><span class="badge gold">${esc(where)}</span>${
    t.historyKept ? '<span class="badge gold">📌 Gardée</span>' : ''
  }</div><h3>${esc(t.title)}</h3><p class="muted">${esc(t.goal || '')}</p><p class="note">${t.proposedAt ? `Proposée le ${esc(frDate(t.proposedAt))} · ` : ''}${ok ? 'terminée' : 'refusée'} le ${esc(frDate(endDate(t)))}</p>${
    t.rejectReason ? `<p>Raison du refus : ${esc(t.rejectReason)}</p>` : ''
  }<div class="actions">${
    t.historyKept
      ? btn('Ne plus garder', `setHistoryKept('${t.id}',false)`)
      : btn('📌 Garder dans l’historique', `setHistoryKept('${t.id}',true)`, 'good')
  }${btn('✓ Lu, retirer', `removeFromHistory('${t.id}')`)}${btn('Ouvrir l’action ↗', `detail('${t.id}')`)}</div></article>`;
}
function historyPage() {
  const items = historyItems();
  const filters = ['Toutes', 'Terminées', 'Refusées', 'Gardées'];
  return `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(
    projectDef.name.toUpperCase(),
  )} / HISTORIQUE</div><h1>Historique</h1><p class="intro">Ce qui est fini : les actions ponctuelles terminées et les actions refusées. Les boucles et les actions en cours restent sur le tableau. « Garder » la conserve ici ; « Lu, retirer » l’enlève de cette liste (une action refusée est alors supprimée).</p></div></div><div class="toolbar">${filters
    .map((f) => btn(f, `setHistoryFilter('${f}')`, historyFilter === f ? 'active' : ''))
    .join('')}</div>${
    items.length
      ? `<div class="grid">${items.map(historyCard).join('')}</div>`
      : '<div class="empty">Aucune décision à afficher.</div>'
  }`;
}
function setHistoryFilter(f) {
  historyFilter = f;
  render();
}
function setHistoryKept(id, kept) {
  const t = task(id);
  if (!t) return;
  t.historyKept = kept;
  save();
  render();
  notify(kept ? 'Gardée dans l’historique.' : 'Elle n’est plus marquée « gardée ».');
}
function removeFromHistory(id) {
  const t = task(id);
  if (!t) return;
  if (t.proposalStatus === 'rejected') {
    modal(
      'Retirer cette action refusée',
      `<p><strong>${esc(t.title)}</strong></p><p>Elle sera supprimée du tableau et de l’historique. L’agent ne la verra plus.</p><div class="actions">${btn(
        '✓ Lu, supprimer',
        `confirmRemoveRejected('${t.id}')`,
        'danger',
      )}${btn('Annuler', 'closeDialog()')}</div>`,
    );
    return;
  }
  t.historyHidden = true;
  save();
  render();
  notify('Retirée de l’historique.');
}
function confirmRemoveRejected(id) {
  data.tasks = data.tasks.filter((t) => t.id !== id);
  if (Array.isArray(data.priorities)) data.priorities = data.priorities.filter((x) => x !== id);
  closeDialog();
  save();
  render();
  notify('Action refusée supprimée.');
}

// render : ajoute le lien Historique et affiche sa page.
const baseRender = render;
render = function () {
  const isHistory = location.hash.slice(1) === HISTORY_SLUG;
  baseRender();
  if (isHistory) {
    const nav = document.getElementById('nav');
    nav.querySelectorAll('a.active').forEach((a) => {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    });
    const me = nav.querySelector(`a[href="#${HISTORY_SLUG}"]`);
    if (me) {
      me.classList.add('active');
      me.setAttribute('aria-current', 'page');
    }
  }
  if (isHistory) {
    document.getElementById('breadcrumb').textContent = 'Historique';
    main.innerHTML = historyPage();
  }
};

render();
