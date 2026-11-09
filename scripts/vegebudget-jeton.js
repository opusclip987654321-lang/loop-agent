// Jeton de lecture des chiffres de vegebudget.fr (/api/stats), pour le relevé de Loop Agent.
//   … | node scripts/vegebudget-jeton.js ranger   -> lit le jeton sur l'entrée standard (jamais affiché)
//   node scripts/vegebudget-jeton.js essai         -> lit les chiffres une fois et affiche seulement des totaux
//   node scripts/vegebudget-jeton.js retirer       -> débranche le relevé
// Le fichier DATA_DIR/vegebudget.json est lisible par le serveur seul (droits 600).
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { lireStats } from '../server/releve-vegebudget.js';

const file = join(process.env.DATA_DIR || './data', 'vegebudget.json');
const cmd = process.argv[2];

if (cmd === 'ranger') {
  let input = '';
  for await (const c of process.stdin) input += c;
  const jeton = input.trim().replace(/^["']|["']$/g, '');
  if (jeton.length < 16 || /\s/.test(jeton)) {
    console.log('Jeton refusé : vide ou mal formé.');
    process.exit(1);
  }
  writeFileSync(file + '.tmp', JSON.stringify({ jeton, url: 'https://vegebudget.fr', range: new Date().toISOString() }), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  chmodSync(file, 0o600);
  console.log('Jeton de vegebudget.fr rangé. Loop Agent relèvera les chiffres du site chaque heure.');
} else if (cmd === 'essai') {
  if (!existsSync(file)) {
    console.log('Aucun jeton rangé.');
    process.exit(1);
  }
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const r = await fetch(new URL('/api/stats?jours=10', c.url), { headers: { authorization: `Bearer ${c.jeton}` }, signal: AbortSignal.timeout(20000) });
  console.log(`vegebudget.fr répond ${r.status}`);
  if (!r.ok) process.exit(1);
  const s = lireStats(await r.json());
  const v = s.jours.reduce((a, j) => a + (j.visiteurs || 0), 0);
  const i = s.jours.reduce((a, j) => a + (j.inscrits || 0), 0);
  console.log(`${s.jours.length} jours lus : ${v} visiteurs, ${i} inscriptions · total : ${s.membres} membres, ${s.abonnes} abonnés payants`);
} else if (cmd === 'retirer') {
  if (existsSync(file)) unlinkSync(file);
  console.log('Relevé de vegebudget.fr débranché.');
} else {
  console.log('Usage : ranger (jeton sur l’entrée standard) | essai | retirer');
  process.exitCode = 1;
}
