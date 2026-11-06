// Transformation unique : maquette (localStorage + démo) -> Loop Agent (serveur, démarrage vide).
// Chaque remplacement vérifie le nombre exact d'occurrences, sinon arrêt.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [src, outDir] = process.argv.slice(2);
const html = readFileSync(src, 'utf8');

function between(s, a, b) {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error('Repère introuvable : ' + a);
  return s.slice(i + a.length, j);
}

let css = between(html, '<style>', '</style>');
let body = between(html, '<body>', '<script>');
let js = between(html, '<script>', '</script>');

function rep(s, find, replacement, count = 1) {
  const n = s.split(find).length - 1;
  if (n !== count) throw new Error(`Attendu ${count} occurrence(s), trouvé ${n} : ${find.slice(0, 90)}`);
  return s.split(find).join(replacement);
}
function repRe(s, re, replacement, count = 1) {
  const n = (s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;
  if (n !== count) throw new Error(`Attendu ${count} occurrence(s), trouvé ${n} : ${re}`);
  return s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), replacement);
}
// Coupe de « from » (inclus) jusqu'à « to » (exclu).
function cut(s, from, to, replacement = '') {
  const i = s.indexOf(from);
  const j = s.indexOf(to, i);
  if (i < 0 || j < 0 || s.indexOf(from, i + 1) >= 0) throw new Error('Coupe impossible : ' + from.slice(0, 60));
  return s.slice(0, i) + replacement + s.slice(j);
}

// ---------- 1. Données de démonstration : retirées ----------
js = cut(js, 'const oldSeed=', 'const socialNetworks=');
js = cut(js, 'const growthSeed=', 'const projects=');
js = cut(js, 'const projects=[', 'function executionPlan(',
  '// Les 8 projets viennent du serveur ; leurs données démarrent vides (cadrage : démarrage vide).\n' +
  'const projects=LA.projects.map(p=>({...p,tasks:[],ideas:[],memories:[]}));\n');
js = repRe(js, /current:\d+,monthlyViews:\d+,followersGained:\d+/, 'current:0,monthlyViews:0,followersGained:0', 4);
js = rep(js, 'themes:(themeSeed[id]||themeSeed.vegebudget).themes,themeSignals:(themeSeed[id]||themeSeed.vegebudget).signals', 'themes:[],themeSignals:{}');
js = repRe(js, /rules:id==='petites-histoires'\?.*?,quota:2/, 'rules:[],quota:2');
js = cut(js, 'const cycleNotes=', 'function loadProject(');
js = rep(js, 'applyWorkflowDemo(d,id);', '');
js = cut(js, 'const DEMO_SCENARIOS={', 'function taskAutonomy(');
js = rep(js, 'applyDemoStates();', '');
const moneyStart = js.indexOf('const moneySeed={');
const moneyEnd = js.indexOf('\nlet moneyData=');
if (moneyStart < 0 || moneyEnd < moneyStart) throw new Error('moneySeed introuvable');
js = js.slice(0, moneyStart) + 'const moneySeed={expenses:[],invoices:[],corrections:[],ai:[]};' + js.slice(moneyEnd);
js = repRe(js, /const MONEY_PROJECTS=\[[^\]]*\];/, "const MONEY_PROJECTS=[...LA.projects.map(p=>p.name),'Commun (plusieurs projets)'];");

// Un projet en pause (L'Extrait politique) a ses boucles permanentes en pause (gris, pas rouge).
js = rep(js,
  'permanentLoops(id,p.name).forEach(seed=>{if(!d.tasks.some(t=>t.id===seed.id))d.tasks.push(JSON.parse(JSON.stringify(seed)))})',
  "permanentLoops(id,p.name).forEach(seed=>{if(!d.tasks.some(t=>t.id===seed.id)){let c=JSON.parse(JSON.stringify(seed));if(p.paused)c.status='En pause';d.tasks.push(c)}})");

// ---------- 2. Stockage : serveur au lieu du navigateur ----------
js = rep(js, "const projectKey=id=>'agent-workspace-project-'+id", "const projectKey=id=>'project:'+id");
js = rep(js, "if(!raw&&id==='vegebudget')raw=localStorage.getItem('vb-proto-v1')", '');
js = rep(js, 'localStorage.getItem(projectKey(id))', 'LA.get(projectKey(id))', 2);
js = rep(js, "localStorage.setItem(projectKey(id),JSON.stringify(d));if(id==='vegebudget')localStorage.setItem('vb-proto-v1',JSON.stringify(d))", 'LA.set(projectKey(id),JSON.stringify(d))');
js = rep(js, "function moneyKey(){return 'agent-workspace-money-v2'}", "function moneyKey(){return 'money'}");
js = rep(js, 'localStorage.getItem(moneyKey())', 'LA.get(moneyKey())');
js = rep(js, 'localStorage.setItem(moneyKey(),JSON.stringify(moneyData))', 'LA.set(moneyKey(),JSON.stringify(moneyData))');

// ---------- 3. Boutons qui simulaient le travail des agents : retirés ----------
js = rep(js, "${btn('Simuler une idée proposée par l’IA',\"newTaskIdea('TID','IA')\".replace('TID',id))}", '');
js = rep(js, "<div class=\"actions\">${btn(connected?'Simuler un accès retiré':'Simuler '+r.name+' connecté',`toggleConnection('${t.id}','${r.id}')`,connected?'':'primary')}</div>", '');
js = rep(js, '<p class="note">Simulation locale.</p>', '<p class="note">L’agent indiquera ici quand l’accès sera branché.</p>');
js = rep(js, "<div class=\"actions\">${btn('✅ Simuler le constat de l’IA',`agentApproveReview('${id}')`,'good')}${btn('↻ Simuler la reprise en exécution par l’IA',`agentReturnToExecution('${id}')`)}</div>", '');
js = rep(js, "${btn('Simuler la révision des consignes','savePrompt()','primary')}${btn('Réinitialiser les consignes de démonstration','resetPrompt()')}", "${btn('Enregistrer les consignes','savePrompt()','primary')}");

js = rep(js, "modal(isAI?'Simuler une idée proposée par l’IA':", "modal(isAI?'Idée proposée par l’IA':");

// ---------- 4. Textes « maquette / simulation » ----------
js = rep(js, 'La pause et les états sont simulés séparément pour chaque tâche. Aucun agent ni service externe n’est connecté.', 'La pause et les états sont propres à chaque tâche.');
js = rep(js, "'Script simulé à générer.'", "'Script à préparer par l’agent.'");
js = rep(js, 'Validation simulée : contenu marqué comme programmé.', 'Contenu validé : marqué comme programmé.');
js = rep(js, 'Ta réponse à cette idée est enregistrée dans cette maquette.', 'Ta réponse à cette idée est enregistrée.');
js = rep(js, 'État de production enregistré localement.', 'État de production enregistré.');
js = rep(js, ' Vues et abonnés gagnés sont des valeurs fictives.', '');
js = rep(js, 'Signal de démonstration : ', 'Signal : ');
js = rep(js, '<p class="tiny" style="margin-top:18px">Maquette interactive · Données de démonstration fictives, conservées dans ce navigateur · Agents, outils et publication simulés.</p>', '');
js = rep(js, "download('remarques-chaine-youtube.md'", "download('remarques-loop-agent.md'");

// ---------- 5. Factures : vrai dépôt, lecture par Claude au prochain passage ----------
js = rep(js,
  '<div class="mdrop"><strong>📎 Dépose tes factures ici</strong><div class="tiny">ou clique pour les choisir · PDF ou photo · 10 Mo max</div><div class="tiny" style="margin-top:6px">Maquette : le dépôt et la lecture automatique demandent une connexion, à brancher plus tard.</div></div>',
  '<label class="mdrop" ondragover="event.preventDefault()" ondrop="dropInvoices(event)"><strong>📎 Dépose tes factures ici</strong><div class="tiny">ou clique pour les choisir · PDF ou photo · 10 Mo max</div><input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onchange="uploadInvoices(this.files);this.value=\'\'"></label>');
js = rep(js, '<strong>${esc(f.file)}</strong>', '<strong>${f.fileId?`<a href="/api/files/${encodeURIComponent(f.fileId)}" target="_blank" rel="noopener">${esc(f.file)}</a>`:esc(f.file)}</strong>');
js = rep(js, "${btn('↻',`notify('Relecture simulée.')`)}", "${btn('↻',`rereadInvoice('${f.id}')`)}");
js = rep(js, '<span class="tiny">lecture en cours…</span>', '<span class="tiny">en attente de lecture par Claude (à son prochain passage)</span>');
js = rep(js, 'Le cerveau lit chaque facture avec Claude (environ 1 centime par facture) et la rapproche de ta liste.', 'Claude lit chaque facture à son prochain passage, sur ton abonnement (aucun coût par facture), et la rapproche de ta liste.');
js = rep(js, '<p class="tiny" style="margin-top:18px">Maquette interactive · Données de démonstration fictives, conservées dans ce navigateur · Dépôt et lecture de factures simulés.</p>', '');

// ---------- 6. Vérifications finales ----------
for (const bad of ['localStorage.getItem(projectKey', 'vb-proto', 'themeSeed', 'cycleNotes', 'DEMO_SCENARIOS', 'applyDemoStates', 'oldSeed', 'moneySeed={expenses:[\n', 'Simuler ', 'Maquette interactive']) {
  if (js.includes(bad)) throw new Error('Reste trouvé : ' + bad);
}

// ---------- HTML ----------
body = rep(body, '<div class="brand">ATELIER <span>AGENTS</span></div>', '<div class="brand">LOOP <span>AGENT</span></div>');
body = rep(body, '<p class="tiny">Projet isolé · données locales</p>', '<p class="tiny">Projet isolé · données enregistrées sur le serveur</p>');
body = rep(body, '<span class="tiny">· propriétaire</span>', '<span class="tiny">· propriétaire</span> <button class="linkbtn" onclick="logout()">Se déconnecter</button>');
body = rep(body, '<span class="badge gold">Prototype · Simulation locale</span>', '<span class="badge" id="syncStatus">Chargement…</span>');

css += '\n.linkbtn{background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;font-size:.8rem}.linkbtn:hover{background:none;color:var(--gold)}\n.mdrop{display:block;cursor:pointer}.mdrop:hover{border-color:var(--gold)}\n.mrow a{color:var(--text)}\n';

const index = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loop Agent</title><link rel="stylesheet" href="/style.css"></head><body>${body.trim()}
<script src="/boot.js"></script>
</body></html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + '/app.js', '// Interface de Loop Agent, issue de atelier-maquette.html (voir scripts de transformation dans l’historique git).\n' + js.trim() + '\n');
writeFileSync(outDir + '/style.css', css.trim() + '\n');
writeFileSync(outDir + '/index.html', index);
console.log('OK', { js: js.length, css: css.length, body: body.length });
