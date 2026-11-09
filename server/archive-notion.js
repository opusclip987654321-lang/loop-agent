// Archive de l'historique Notion des loops, importée une fois dans chaque projet (09/11/2026,
// décision de Walid : Loop Agent remplace le cerveau central et Notion). Lecture seule ensuite :
// les agents la voient dans lire_projet → archive_notion.

const LOOPS = {
  'Nūr Meet restaurateurs': 'nourmeet',
  'Nūr Meet grand public': 'nourmeet',
  'VégéBudget': 'vegebudget',
  'Petites histoires vraies': 'petites-histoires',
  'Impacteur Sponsors': 'impacteur-sponsors',
  'Impacteur invitations': 'impacteur-mail',
  Leviaro: 'leviaro',
  'Toutes les loops': 'gestion-loop-agent',
  'Associé business': 'gestion-loop-agent',
};
const PAGES = { 'nour-restos': 'nourmeet', 'nour-grand-public': 'nourmeet', vegebudget: 'vegebudget', 'petites-histoires': 'petites-histoires', impacteur: 'impacteur-mail', 'impacteur-sponsors': 'impacteur-sponsors', leviaro: 'leviaro', regles: 'gestion-loop-agent', 'revue-systeme': 'gestion-loop-agent' };
const FAIT = { 'Nūr Meet': 'nourmeet', Leviaro: 'leviaro', Impacteur: 'impacteur-communaute', 'Petites histoires vraies': 'petites-histoires', 'VégéBudget': 'vegebudget' };

// Dans le cerveau, Walid était appelé « louis » : on remet son prénom.
const s = (v, max) => (typeof v === 'string' && v.trim() && v.trim() !== '—' ? v.trim().replace(/\blouis\b/g, 'Walid').slice(0, max) : null);
const jour = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);

// Le projet d'une décision : sa loop, ou pour le SEO le site nommé en tête.
export function projetDe(d) {
  if (d.loop === 'SEO') return /^Nūr Meet/.test(d.decision || '') ? 'nourmeet' : /^VégéBudget/.test(d.decision || '') ? 'vegebudget' : /^Leviaro/.test(d.decision || '') ? 'leviaro' : null;
  return LOOPS[d.loop] || (d.loop ? null : 'gestion-loop-agent');
}

export function archiveParProjet(src, nowIso = new Date().toISOString()) {
  const out = {};
  const a = (id) => (out[id] ??= { importe: nowIso, source: 'Notion « Loops des projets » (cerveau central)', decisions: [], pages: [], fait: [] });
  for (const d of Array.isArray(src.decisions) ? src.decisions : []) {
    const id = projetDe(d || {});
    const decision = s(d && d.decision, 1200);
    if (!id || !decision) continue;
    a(id).decisions.push({ date: jour(d.date), loop: s(d.loop, 60), type: s(d.type, 30), decision, pourquoi: s(d.pourquoi, 1500) });
  }
  for (const p of Array.isArray(src.pages) ? src.pages : []) {
    const id = PAGES[p && p.cle];
    const texte = s(p && p.texte, 20000);
    if (id && texte) a(id).pages.push({ titre: s(p.titre, 120), texte });
  }
  for (const f of Array.isArray(src.fait) ? src.fait : []) {
    const id = FAIT[f && f.projet];
    if (id && s(f.quoi, 400)) a(id).fait.push({ date: jour(f.date), quoi: s(f.quoi, 400), nombre: typeof f.nombre === 'number' ? f.nombre : null, par: s(f.par, 120) });
  }
  for (const x of Object.values(out)) x.decisions.sort((p, q) => ((p.date || '') < (q.date || '') ? 1 : -1));
  return out;
}

// Ce que voit l'agent : leçons et décisions passées (les plus récentes d'abord), et la page du projet.
export function pourAgent(archive) {
  if (!archive) return undefined;
  const lecons = archive.decisions.filter((d) => d.type === 'Leçon');
  const autres = archive.decisions.filter((d) => d.type !== 'Leçon');
  return {
    consigne: 'Historique tenu dans Notion jusqu’au 09/11/2026 (le cerveau central est arrêté). Relis-le comme ta mémoire : ne refais pas un essai déjà jugé, respecte les « Geste de Walid » (ses décisions). Notion n’est plus mis à jour : tout se note désormais ici.',
    importe_le: archive.importe.slice(0, 10),
    lecons: lecons.slice(0, 30).map((d) => ({ date: d.date, lecon: d.decision, pourquoi: d.pourquoi || undefined })),
    decisions: autres.slice(0, 30).map((d) => ({ date: d.date, type: d.type, decision: d.decision, pourquoi: d.pourquoi || undefined })),
    pages: archive.pages.map((p) => ({ titre: p.titre, texte: p.texte.slice(0, 4000), coupee: p.texte.length > 4000 || undefined })),
  };
}
