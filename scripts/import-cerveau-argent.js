// Import unique de la page Argent du cerveau central dans Loop Agent
// (document de travail §7 : Walid compte désactiver le cerveau central).
//
// Usage (dans le conteneur) :
//   node scripts/import-cerveau-argent.js <dossier>          → montre ce qui serait importé
//   node scripts/import-cerveau-argent.js <dossier> --ecrire → importe
// <dossier> contient argent.json et factures/<id>.pdf, copiés depuis le
// conteneur du cerveau (/app/data).
//
// Règles :
// - rien n'est écrasé : les lignes déjà importées (cerveauId) sont ignorées,
//   on peut relancer sans doublon ;
// - une sauvegarde de la base est faite avant d'écrire ;
// - l'écriture est versionnée comme toutes les autres (refusée si quelqu'un
//   a écrit entre-temps : il suffit de relancer).
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb } from '../server/db.js';
import { defaultMoneyDoc } from '../server/defaults.js';

const PROJETS = {
  commun: 'Commun (plusieurs projets)',
  'nour-meet': 'Nūr Meet',
  leviaro: 'Leviaro',
  'extrait-politique': 'L’Extrait politique',
  'histoires-vraies': 'Petites Histoires Vraies',
  impacteur: 'Commun (plusieurs projets)',
  cambodge: 'Agent Cambodge emploi',
  vegebudget: 'VégéBudget',
};
const FREQ = { mois: 'mois', an: 'an', 'une-fois': 'une fois' };

// Convertit les données du cerveau au format de Loop Agent. Pure : testable.
export function convertir(cerveau, money, { mois0 = '2026-09' } = {}) {
  const out = JSON.parse(JSON.stringify(money));
  out.expenses = out.expenses || [];
  out.invoices = out.invoices || [];
  out.corrections = out.corrections || [];
  const deja = new Set([...out.expenses, ...out.invoices, ...out.corrections].map((x) => x.cerveauId).filter(Boolean));
  const lignes = cerveau.lignes || [];
  const nomLigne = Object.fromEntries(lignes.map((l) => [l.id, l.libelle]));
  const factures = cerveau.factures || [];
  const ajout = { depenses: 0, factures: 0, corrections: 0, fichiers: [] };

  for (const l of lignes) {
    if (deja.has(l.id)) continue;
    const freq = FREQ[l.frequence] || 'une fois';
    // Facture la plus récente rattachée à cette ligne.
    const lues = factures
      .filter((f) => f.lecture && f.lecture.estUneFacture && f.lecture.ligne === l.id && !f.doublonDe)
      .sort((a, b) => String(b.lecture.date).localeCompare(String(a.lecture.date)));
    const e = {
      id: 'cv-' + l.id,
      cerveauId: l.id,
      name: l.libelle,
      amount: l.montant,
      cur: l.devise,
      freq,
      date: l.date || '',
      project: PROJETS[l.projet] || 'Commun (plusieurs projets)',
      invoice: lues.length ? { date: lues[0].lecture.date, amount: lues[0].lecture.montant } : null,
    };
    if (freq !== 'une fois') e.since = l.date ? l.date.slice(0, 7) : mois0;
    out.expenses.push(e);
    ajout.depenses++;
  }

  for (const f of factures) {
    if (deja.has(f.id)) continue;
    const r = f.lecture;
    const inv = { id: 'cv-' + f.id, cerveauId: f.id, file: f.nom, addedAt: f.ajoutee, cerveauFichier: f.id };
    if (!r) inv.state = 'lecture';
    else if (r.estUneFacture === false) inv.state = 'pas-facture';
    else if (f.doublonDe) Object.assign(inv, { state: 'doublon', dup: f.doublonDe });
    else
      Object.assign(inv, {
        state: 'lue',
        vendor: r.fournisseur,
        amount: r.montant,
        cur: r.devise,
        date: r.date,
        period: r.periode || '—',
        match: nomLigne[r.ligne] || undefined,
        readAt: r.lueLe,
      });
    out.invoices.push(inv);
    ajout.factures++;
    ajout.fichiers.push({ invoice: inv.id, source: f.id, name: f.nom, mime: f.type || 'application/pdf' });
  }

  for (const c of cerveau.corrections || []) {
    if (deja.has(c.id)) continue;
    const a = c.avant || {},
      b = c.apres || {};
    out.corrections.push({
      id: 'cv-' + c.id,
      cerveauId: c.id,
      label: c.libelle,
      detail:
        a.montant === undefined
          ? `ajoutée d’après la facture : ${b.montant} ${b.devise || ''}${b.date ? ' (' + b.date + ')' : ''}`
          : `${a.montant} ${a.devise || ''}${a.date ? ' (' + a.date + ')' : ''} → ${b.montant} ${b.devise || ''}${b.date ? ' (' + b.date + ')' : ''}`,
      at: c.quand,
      undone: false,
    });
    ajout.corrections++;
  }
  return { money: out, ajout };
}

async function main() {
  const [dir, flag] = process.argv.slice(2);
  if (!dir) {
    console.error('Usage : node scripts/import-cerveau-argent.js <dossier> [--ecrire]');
    process.exit(2);
  }
  const dataDir = process.env.DATA_DIR || './data';
  const cerveau = JSON.parse(await readFile(join(dir, 'argent.json'), 'utf8'));
  const db = openDb(dataDir);
  const cur = db.getDoc('money');
  const money = cur ? JSON.parse(cur.value) : defaultMoneyDoc();
  const { money: next, ajout } = convertir(cerveau, money);
  console.log(`À importer : ${ajout.depenses} dépense(s), ${ajout.factures} facture(s), ${ajout.corrections} correction(s).`);
  if (flag !== '--ecrire') {
    console.log('Rien écrit (ajoute --ecrire pour importer).');
    return;
  }
  if (!ajout.depenses && !ajout.factures && !ajout.corrections) return console.log('Déjà importé : rien à faire.');

  await mkdir(join(dataDir, 'backups'), { recursive: true });
  const backup = join(dataDir, 'backups', `avant-import-cerveau-${Date.now()}.sqlite`);
  db.backupTo(backup);
  console.log('Sauvegarde :', backup);

  // Fichiers des factures : copiés dans le stockage de Loop Agent.
  await mkdir(join(dataDir, 'files'), { recursive: true });
  for (const f of ajout.fichiers) {
    const src = join(dir, 'factures', f.source + '.pdf');
    const inv = next.invoices.find((x) => x.id === f.invoice);
    if (!existsSync(src)) {
      console.log('Fichier absent, facture gardée sans fichier :', f.name);
      continue;
    }
    const id = randomBytes(12).toString('hex');
    await copyFile(src, join(dataDir, 'files', id));
    const size = (await readFile(src)).length;
    db.addFile({ id, name: f.name, mime: f.mime, size });
    inv.fileId = id;
  }
  const r = db.putDoc('money', JSON.stringify(next), cur ? cur.version : 0, 'import:cerveau');
  if (!r.ok) {
    console.error('La page Argent a changé pendant l’import : rien écrit, relance la commande.');
    process.exit(1);
  }
  console.log('Import terminé. Version de la page Argent :', r.version);
  await writeFile(join(dataDir, 'backups', 'import-cerveau-fait.txt'), new Date().toISOString() + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => (console.error(e), process.exit(1)));
