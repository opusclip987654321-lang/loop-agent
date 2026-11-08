// Adresse secrète de l'automatisation n8n « CERVEAU - lecture des boîtes ».
//   … | node scripts/boites-adresse.js ranger   -> lit l'adresse sur l'entrée standard (jamais affichée)
//   node scripts/boites-adresse.js essai         -> appelle n8n une fois et affiche seulement des comptes
//   node scripts/boites-adresse.js retirer       -> débranche la lecture des boîtes
// Le fichier DATA_DIR/boites.json est lisible par le serveur seul (droits 600).
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { WEBHOOK_RE, BOITES, lireReponse } from '../server/boites.js';

const dataDir = process.env.DATA_DIR || './data';
const file = join(dataDir, 'boites.json');
const cmd = process.argv[2];

if (cmd === 'ranger') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const url = input.trim().split(/\s+/)[0] || '';
  if (!WEBHOOK_RE.test(url)) {
    console.log('Adresse refusée : elle doit être https://n8n.nourmeet.com/webhook/cerveau-boites-<32 caractères>.');
    process.exit(1);
  }
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ url, savedAt: new Date().toISOString() }), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  console.log('Adresse des boîtes rangée. Loop Agent lira tes 6 boîtes chaque heure.');
} else if (cmd === 'essai') {
  if (!existsSync(file)) {
    console.log('Aucune adresse rangée.');
    process.exit(1);
  }
  const { url } = JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  console.log(`n8n répond ${res.status}`);
  if (!res.ok) process.exit(1);
  const { etat, mails } = lireReponse(await res.json());
  for (const b of BOITES) console.log(`${b.id.padEnd(17)} ${etat[b.id].lue ? `lue (${etat[b.id].n} mails)` : 'PAS LUE : ' + etat[b.id].erreur}`);
  console.log(`urgents : ${mails.filter((m) => m.niveau === 'urgent').length} · à traiter : ${mails.filter((m) => m.niveau === 'a-traiter').length}`);
} else if (cmd === 'retirer') {
  if (existsSync(file)) unlinkSync(file);
  console.log('Lecture des boîtes débranchée.');
} else {
  console.log('Usage : ranger (adresse sur l’entrée standard) | essai | retirer');
  process.exitCode = 1;
}
