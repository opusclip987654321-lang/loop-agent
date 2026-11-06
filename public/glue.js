// Raccord entre l'interface (app.js) et le serveur.
// Chargé après app.js : les fonctions déclarées ici remplacent celles de la
// maquette qui simulaient un service (Telegram, coût de l'IA, factures).
'use strict';

// ---------- Rechargement quand un agent écrit ----------
let rerenderPending = false;

function safeRerender() {
  const dialog = document.getElementById('dialog');
  const active = document.activeElement;
  const typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  if (dialog.open || typing) {
    rerenderPending = true;
    return;
  }
  rerenderPending = false;
  render();
}

document.getElementById('dialog').addEventListener('close', () => {
  if (rerenderPending) safeRerender();
});
document.addEventListener('focusout', () => {
  if (rerenderPending) setTimeout(safeRerender, 0);
});

LA.onRemoteChange = function (key, conflict) {
  if (key === projectKey(projectId)) data = loadProject(projectId);
  else if (key === moneyKey()) moneyData = loadMoney();
  // Un autre projet : seule sa couleur dans le sélecteur peut changer.
  safeRerender();
  if (conflict)
    notify('Un agent a modifié ces données au même moment : sa version est affichée. Refais ta dernière modification si besoin.');
};

// ---------- Alertes Telegram (branchées à l'étape 3) ----------
function telegramPanel() {
  const count = pendingApprovalCount();
  return `<section class="card space"><span class="tiny">ALERTES DE VALIDATION</span><h2 style="margin:5px 0">Récapitulatif Telegram</h2><p class="note">${
    count ? count + ' proposition(s) attendent ta réponse.' : 'Aucune proposition n’attend ta réponse.'
  } Un message groupé par tour d’agent te préviendra dès que le bot sera branché.</p></section>`;
}

// ---------- Coût de l'IA : aucun appel payant ----------
function moneyAI() {
  return `<section class="tile"><h2 style="margin-top:0">Ce que l’IA coûte ce mois-ci</h2><p class="note">Aucun appel payant : les agents et la lecture des factures tournent sur ton abonnement Claude, quand Claude est allumé. L’abonnement lui-même se suit dans « Dépenses ».</p></section>`;
}

// ---------- Factures : dépôt réel, lecture par Claude au prochain passage ----------
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

async function uploadInvoices(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (file.size > MAX_INVOICE_BYTES) {
      notify(file.name + ' : plus de 10 Mo, non déposée.');
      continue;
    }
    try {
      const f = await LA.upload(file);
      moneyData.invoices.unshift({
        id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        file: f.name,
        fileId: f.id,
        state: 'lecture',
        addedAt: new Date().toISOString(),
      });
      saveMoney();
      render();
      notify('Facture déposée : Claude la lira à son prochain passage.');
    } catch (e) {
      notify(file.name + ' : ' + e.message);
    }
  }
}

function dropInvoices(event) {
  event.preventDefault();
  uploadInvoices(event.dataTransfer && event.dataTransfer.files);
}

function rereadInvoice(id) {
  const f = moneyData.invoices.find((x) => x.id === id);
  if (!f) return;
  f.state = 'lecture';
  saveMoney();
  render();
  notify('Claude relira cette facture à son prochain passage.');
}

function deleteInvoice(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  const f = moneyData.invoices.find((x) => x.id === id);
  moneyData.invoices = moneyData.invoices.filter((x) => x.id !== id);
  saveMoney();
  render();
  if (f && f.fileId) LA.deleteFile(f.fileId).catch(() => notify('Le fichier n’a pas pu être supprimé du serveur.'));
  notify('Facture supprimée.');
}

// Premier affichage avec les fonctions ci-dessus.
render();
