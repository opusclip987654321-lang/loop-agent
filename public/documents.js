// Onglet Documents (demande de Walid du 11/11/2026) : un tableau de tous les documents
// importés dans le projet (relevés bancaires, charges, factures…) et de ce que le projet
// en a retenu, pour savoir d'un coup d'œil ce qui est déjà pris en compte.
// Registre seulement (décision de Walid du 11/11/2026 : ses documents sont sensibles) :
// aucun fichier n'est envoyé à Loop Agent, seulement le nom, le type, la période,
// l'endroit où il se trouve et ce qui en a été retenu (enregistrer_document côté agent).
// - Walid peut signaler un document (« à lire ») : l'agent le lit là où il est.
// - Les factures de la page Argent rapprochées d'une dépense de ce projet s'affichent en dessous.
// Chargé après resultats.js : ajoute le lien et la page, comme historique.js.
'use strict';

const DOCS_SLUG = 'documents';
const DOC_KINDS = ['Relevé bancaire', 'Charges', 'Facture', 'Impôts', 'Prêt', 'Bail', 'Acte / compromis', 'Assurance', 'Courrier', 'Autre'];
const DOC_STATES = ['à lire', 'pris en compte', 'ignoré'];
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

function addDocumentDialog() {
  const kinds = DOC_KINDS.map((k) => `<option>${esc(k)}</option>`).join('');
  modal(
    'Signaler un document',
    `<p class="note">Le fichier reste chez toi : note seulement où il est. L’agent le lira là-bas à son prochain tour.</p><label for="docName">Nom du document</label><input id="docName" placeholder="ex. Relevé compte courant octobre 2026"><label for="docKind">Type</label><select id="docKind">${kinds}</select><label for="docPeriod">Période</label><input id="docPeriod" placeholder="ex. octobre 2026"><label for="docWhere">Où il se trouve</label><input id="docWhere" placeholder="ex. dossier Immo du Mac, fichiers du projet Claude"><div class="actions">${btn('Ajouter', 'addDocument()', 'good')}${btn('Annuler', 'closeDialog()')}</div>`,
  );
}
function addDocument() {
  const val = (id) => String(document.getElementById(id).value || '').trim().slice(0, 160);
  const name = val('docName');
  if (!name) return notify('Donne un nom au document.');
  const kind = DOC_KINDS.includes(val('docKind')) ? val('docKind') : 'Autre';
  docList().unshift({
    id: 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    kind,
    period: val('docPeriod'),
    source: val('docWhere'),
    addedAt: new Date().toISOString(),
    addedBy: 'walid',
    state: 'à lire',
  });
  closeDialog();
  save();
  render();
  notify('Document noté : l’agent le lira à son prochain tour.');
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
  if (!confirm(`Retirer « ${d.name} » de la liste ? (le fichier chez toi n’est pas touché)`)) return;
  data.documents = docList().filter((x) => x.id !== id);
  save();
  render();
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
  const name = esc(d.name);
  const where = d.source ? `<div class="tiny">Où : ${esc(d.source)}</div>` : '';
  const kinds = DOC_KINDS.map((k) => `<option${k === d.kind ? ' selected' : ''}>${esc(k)}</option>`).join('');
  return `<tr>
<td><strong>${name}</strong>${where}</td>
<td><select onchange="setDocField('${docSafeId(d.id)}','kind',this.value)" style="min-width:160px">${kinds}</select></td>
<td><input value="${esc(d.period || '')}" placeholder="ex. octobre 2026" onchange="setDocField('${docSafeId(d.id)}','period',this.value)" style="min-width:110px"></td>
<td>${esc(docDate(d.addedAt))}<div class="tiny">par ${d.addedBy === 'agent' ? 'l’agent' : 'toi'}</div></td>
<td>${docStateBadge(d)}</td>
<td>${d.summary ? esc(d.summary) : '<span class="tiny">—</span>'}</td>
<td style="white-space:nowrap">${d.state !== 'à lire' ? btn('↻', `rereadDocument('${docSafeId(d.id)}')`) : ''}${btn('✕', `deleteDocument('${docSafeId(d.id)}')`)}</td>
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
    ? `<div style="overflow-x:auto"><table class="mtbl"><thead><tr><th>Document</th><th>Type</th><th>Période</th><th>Noté le</th><th>État</th><th>Ce que le projet en a retenu</th><th></th></tr></thead><tbody>${shown
        .map(docRow)
        .join('')}</tbody></table></div>`
    : `<div class="empty">${all.length ? 'Aucun document pour ce filtre.' : 'Aucun document noté pour l’instant.'}</div>`;
  const inv = projectInvoices();
  const invSection = inv.length
    ? `<section class="tile" style="margin-top:18px"><h2 style="margin-top:0">Factures de la page Argent</h2><table class="mtbl"><thead><tr><th>Facture</th><th>Dépense</th><th class="r">Montant</th><th>Date</th></tr></thead><tbody>${inv
        .map(
          (f) =>
            `<tr><td>${f.fileId ? `<a href="/api/files/${encodeURIComponent(f.fileId)}" target="_blank" rel="noopener">${esc(f.file)}</a>` : esc(f.file)}</td><td>${esc(f.match)}</td><td class="r">${esc(f.amount ?? '—')} ${esc(f.cur || '')}</td><td>${esc(f.date || '—')}</td></tr>`,
        )
        .join('')}</tbody></table><p class="tiny">Déposées dans la page Argent et rapprochées d’une dépense de ce projet.</p></section>`
    : '';
  return `<div class="heading"><div><div class="tiny" style="margin-bottom:8px">${esc(projectDef.name.toUpperCase())} / DOCUMENTS</div><h1>Documents</h1><p class="intro">Tous les documents que le projet a lus (relevés bancaires, charges, factures…) et ce qu’il en a retenu. « Pris en compte » : l’agent l’a lu et s’en sert ; il ne le recompte pas.</p></div></div>
<p><strong>${all.length}</strong> document${all.length > 1 ? 's' : ''} · <strong>${counts['pris en compte']}</strong> pris en compte · <strong>${counts['à lire']}</strong> à lire${counts['ignoré'] ? ` · ${counts['ignoré']} ignoré${counts['ignoré'] > 1 ? 's' : ''}` : ''}</p>
<p class="note">🔒 Tes documents ne sont jamais envoyés ici : ils restent chez toi (Mac, fichiers du projet Claude). Ce tableau garde seulement leur nom, où ils sont et ce que le projet en a retenu.</p><div class="actions">${btn('+ Signaler un document', 'addDocumentDialog()', 'good')}</div>
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
