// Onglet Documents (demande de Walid du 11/11/2026) : un tableau de tous les documents
// importés dans le projet (relevés bancaires, charges, factures…) et de ce que le projet
// en a retenu, pour savoir d'un coup d'œil ce qui est déjà pris en compte.
// - Walid dépose un fichier ici : il est « à lire » ; l'agent le lit au prochain tour
//   (documents_a_lire, lire_document) et note ce qu'il a retenu (enregistrer_document).
// - Un document lu ailleurs par l'agent (dossier de Walid, pièce jointe) est noté aussi,
//   sans fichier, avec l'endroit où il se trouve.
// - Les factures de la page Argent rapprochées d'une dépense de ce projet s'affichent en dessous.
// Chargé après resultats.js : ajoute le lien et la page, comme historique.js.
'use strict';

const DOCS_SLUG = 'documents';
const DOC_KINDS = ['Relevé bancaire', 'Charges', 'Facture', 'Impôts', 'Prêt', 'Bail', 'Acte / compromis', 'Assurance', 'Courrier', 'Autre'];
const DOC_STATES = ['à lire', 'pris en compte', 'ignoré'];
const MAX_DOC_BYTES = 10 * 1024 * 1024;
let docStateFilter = 'Tous';
let docKindFilter = 'Tous';

function docList() {
  if (!Array.isArray(data.documents)) data.documents = [];
  return data.documents;
}
const docSafeId = (id) => String(id || '').replace(/[^\w-]/g, '');
function docById(id) {
  return docList().find((d) => d.id === id);
}
// Type deviné d'après le nom du fichier ; Walid peut le changer dans le tableau.
function guessDocKind(name) {
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/releve|extrait|compte|\.ofx$|\.qif$/.test(n)) return 'Relevé bancaire';
  if (/charge|copro|syndic|regularisation/.test(n)) return 'Charges';
  if (/facture|invoice/.test(n)) return 'Facture';
  if (/impot|avis d|taxe|fiscal/.test(n)) return 'Impôts';
  if (/pret|emprunt|amortissement|credit/.test(n)) return 'Prêt';
  if (/bail|loyer|quittance|locat/.test(n)) return 'Bail';
  if (/compromis|acte|notaire|vente/.test(n)) return 'Acte / compromis';
  if (/assurance|pno|mrh/.test(n)) return 'Assurance';
  return 'Autre';
}
function docDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function docStateBadge(d) {
  if (d.state === 'pris en compte') return `<span class="badge green">✓ Pris en compte</span><div class="tiny">le ${esc(docDate(d.readAt))}</div>`;
  if (d.state === 'ignoré') return `<span class="badge">Ignoré</span><div class="tiny">le ${esc(docDate(d.readAt))}</div>`;
  return '<span class="badge yellow">À lire</span><div class="tiny">au prochain tour de l’agent</div>';
}

async function uploadDocuments(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (file.size > MAX_DOC_BYTES) {
      notify(file.name + ' : plus de 10 Mo, non importé.');
      continue;
    }
    try {
      const f = await LA.upload(file);
      docList().unshift({
        id: 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: f.name,
        kind: guessDocKind(f.name),
        period: '',
        fileId: f.id,
        mime: f.mime,
        size: f.size,
        addedAt: new Date().toISOString(),
        addedBy: 'walid',
        state: 'à lire',
      });
      save();
      render();
      notify('Document importé : l’agent le lira à son prochain tour.');
    } catch (e) {
      notify(file.name + ' : ' + e.message);
    }
  }
}
function dropDocuments(event) {
  event.preventDefault();
  uploadDocuments(event.dataTransfer && event.dataTransfer.files);
}
function setDocField(id, field, value) {
  const d = docById(id);
  if (!d) return;
  if (field === 'kind' && !DOC_KINDS.includes(value)) return;
  d[field] = String(value || '').slice(0, 160);
  save();
}
function rereadDocument(id) {
  const d = docById(id);
  if (!d) return;
  d.state = 'à lire';
  save();
  render();
  notify('L’agent relira ce document à son prochain tour.');
}
function deleteDocument(id) {
  const d = docById(id);
  if (!d) return;
  if (!confirm(`Retirer « ${d.name} » de la liste ?${d.fileId ? ' Le fichier sera supprimé.' : ''}`)) return;
  data.documents = docList().filter((x) => x.id !== id);
  save();
  render();
  if (d.fileId) LA.deleteFile(d.fileId).catch(() => notify('Le fichier n’a pas pu être supprimé du serveur.'));
  notify('Document retiré.');
}
function setDocStateFilter(f) {
  docStateFilter = f;
  render();
}
function setDocKindFilter(f) {
  docKindFilter = f;
  render();
}

function docRow(d) {
  const name = d.fileId
    ? `<a href="/api/files/${encodeURIComponent(d.fileId)}" target="_blank" rel="noopener">${esc(d.name)}</a>`
    : esc(d.name);
  const where = d.fileId ? '' : d.source ? `<div class="tiny">Lu ici : ${esc(d.source)}</div>` : '';
  const kinds = DOC_KINDS.map((k) => `<option${k === d.kind ? ' selected' : ''}>${esc(k)}</option>`).join('');
  return `<tr>
<td><strong>${name}</strong>${where}</td>
<td><select onchange="setDocField('${docSafeId(d.id)}','kind',this.value)" style="min-width:160px">${kinds}</select></td>
<td><input value="${esc(d.period || '')}" placeholder="ex. octobre 2026" onchange="setDocField('${docSafeId(d.id)}','period',this.value)" style="min-width:110px"></td>
<td>${esc(docDate(d.addedAt))}<div class="tiny">par ${d.addedBy === 'agent' ? 'l’agent' : 'toi'}</div></td>
<td>${docStateBadge(d)}</td>
<td>${d.summary ? esc(d.summary) : '<span class="tiny">—</span>'}</td>
<td style="white-space:nowrap">${d.fileId && d.state !== 'à lire' ? btn('↻', `rereadDocument('${docSafeId(d.id)}')`) : ''}${btn('✕', `deleteDocument('${docSafeId(d.id)}')`)}</td>
</tr>`;
}

// Factures de la page Argent rapprochées d'une dépense de ce projet (lecture seule ici).
function projectInvoices() {
  const money = typeof moneyData === 'object' && moneyData ? moneyData : null;
  if (!money) return [];
  const mine = new Set((money.expenses || []).filter((e) => e.project === projectDef.name).map((e) => e.name));
  return (money.invoices || []).filter((f) => f.match && mine.has(f.match));
}

function documentsPage() {
  const all = docList();
  const counts = Object.fromEntries(DOC_STATES.map((s) => [s, all.filter((d) => d.state === s).length]));
  const shown = all.filter(
    (d) =>
      (docStateFilter === 'Tous' || d.state === docStateFilter) && (docKindFilter === 'Tous' || d.kind === docKindFilter),
  );
  const stateFilters = ['Tous', ...DOC_STATES]
    .map((f) => btn(f === 'Tous' ? 'Tous' : f[0].toUpperCase() + f.slice(1), `setDocStateFilter('${f}')`, docStateFilter === f ? 'active' : ''))
    .join('');
  const kindOptions = ['Tous', ...DOC_KINDS]
    .map((k) => `<option value="${esc(k)}"${k === docKindFilter ? ' selected' : ''}>${k === 'Tous' ? 'Tous les types' : esc(k)}</option>`)
    .join('');
  const table = shown.length
    ? `<div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Document</th><th>Type</th><th>Période</th><th>Importé</th><th>État</th><th>Ce que le projet en a retenu</th><th></th></tr></thead><tbody>${shown
        .map(docRow)
        .join('')}</tbody></table></div>`
    : `<div class="empty">${all.length ? 'Aucun document pour ce filtre.' : 'Aucun document importé pour l’instant.'}</div>`;
  const inv = projectInvoices();
  const invSection = inv.length
    ? `<section class="tile" style="margin-top:18px"><h2 style="margin-top:0">Factures de la page Argent</h2><table class="mtbl"><thead><tr><th>Facture</th><th>Dépense</th><th class="r">Montant</th><th>Date</th></tr></thead><tbody>${inv
        .map(
          (f) =>
            `<tr><td>${f.fileId ? `<a href="/api/files/${encodeURIComponent(f.fileId)}" target="_blank" rel="noopener">${esc(f.file)}</a>` : esc(f.file)}</td><td>${esc(f.match)}</td><td class="r">${esc(f.amount ?? '—')} ${esc(f.cur || '')}</td><td>${esc(f.date || '—')}</td></tr>`,
        )
        .join('')}</tbody></table><p class="tiny">Déposées dans la page Argent et rapprochées d’une dépense de ce projet.</p></section>`
    : '';
  return `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(projectDef.name.toUpperCase())} / DOCUMENTS</div><h1>Documents</h1><p class="intro">Tous les documents importés dans ce projet (relevés bancaires, charges, factures…) et ce que le projet en a retenu. « Pris en compte » : l’agent l’a lu et s’en sert ; il ne le recompte pas.</p></div></div>
<p><strong>${all.length}</strong> document${all.length > 1 ? 's' : ''} · <strong>${counts['pris en compte']}</strong> pris en compte · <strong>${counts['à lire']}</strong> à lire${counts['ignoré'] ? ` · ${counts['ignoré']} ignoré${counts['ignoré'] > 1 ? 's' : ''}` : ''}</p>
<label class="mdrop" ondragover="event.preventDefault()" ondrop="dropDocuments(event)"><strong>📎 Dépose tes documents ici</strong><div class="tiny">ou clique pour les choisir · PDF, photo, CSV, OFX, QIF, texte ou Excel · 10 Mo max</div><input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.md,.ofx,.qif,.xlsx,.xls" onchange="uploadDocuments(this.files);this.value=''"></label>
<div class="toolbar" style="margin-top:14px">${stateFilters}<select onchange="setDocKindFilter(this.value)" style="width:auto">${kindOptions}</select></div>
${table}${invSection}`;
}

// render : ajoute le lien Documents (après Historique) et affiche sa page.
const baseRenderDocuments = render;
render = function () {
  const isDocs = location.hash.slice(1) === DOCS_SLUG;
  baseRenderDocuments();
  const nav = document.getElementById('nav');
  if (isDocs) nav.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  nav.insertAdjacentHTML('beforeend', `<a href="#${DOCS_SLUG}" class="${isDocs ? 'active' : ''}"><span class="num">📄</span>Documents</a>`);
  if (isDocs) {
    document.getElementById('breadcrumb').textContent = 'Documents';
    main.innerHTML = documentsPage();
  }
};

render();
