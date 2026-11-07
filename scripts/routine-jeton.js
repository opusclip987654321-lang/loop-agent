// Range l'adresse et le jeton du déclencheur « API » d'une routine Claude,
// pour que Loop Agent relance l'agent d'un projet après une décision de Walid.
//   node scripts/routine-jeton.js ranger <projet>   -> demande l'adresse puis le jeton (jeton masqué)
//   node scripts/routine-jeton.js liste             -> projets branchés (sans montrer les jetons)
//   node scripts/routine-jeton.js retirer <projet>  -> débranche un projet
// Le fichier DATA_DIR/routines.json est lisible par le serveur seul (droits 600).
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS } from '../server/projects.js';

const dataDir = process.env.DATA_DIR || './data';
const file = join(dataDir, 'routines.json');
const [cmd, project] = process.argv.slice(2);

function load() {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}
function save(obj) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let buf = '';
    if (hidden && stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          if (hidden && stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          return resolve(buf.trim());
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const known = new Set(PROJECTS.map((p) => p.id));

if (cmd === 'ranger' && project) {
  if (!known.has(project)) {
    console.log(`Projet inconnu : ${project}. Projets : ${[...known].join(', ')}`);
    process.exit(1);
  }
  const url = await ask('Adresse du déclencheur (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire) : ');
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/.test(url)) {
    console.log('Adresse refusée : elle doit avoir la forme ci-dessus.');
    process.exit(1);
  }
  const token = await ask('Jeton (sk-ant-oat01-…, ne s’affiche pas) : ', true);
  if (!/^sk-ant-oat01-\S+$/.test(token)) {
    console.log('Jeton refusé : il doit commencer par sk-ant-oat01-.');
    process.exit(1);
  }
  const all = load();
  all[project] = { url, token, savedAt: new Date().toISOString() };
  save(all);
  console.log(`Routine de ${project} rangée. Loop Agent la relancera après tes décisions (au plus une fois toutes les 30 minutes).`);
} else if (cmd === 'liste') {
  const all = load();
  const ids = Object.keys(all);
  if (!ids.length) console.log('Aucun projet branché.');
  for (const id of ids) console.log(`${id}  ${all[id].url.replace(/.*routines\/(trig_[^/]+).*/, '$1')}  rangé le ${all[id].savedAt || '?'}`);
} else if (cmd === 'retirer' && project) {
  const all = load();
  if (!all[project]) console.log(`${project} n’est pas branché.`);
  else {
    delete all[project];
    save(all);
    console.log(`${project} débranché.`);
  }
} else {
  console.log('Usage : ranger <projet> | liste | retirer <projet>');
  process.exitCode = 1;
}
