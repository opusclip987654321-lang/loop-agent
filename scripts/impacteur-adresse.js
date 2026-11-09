// Adresse secrète de l'automatisation n8n « CERVEAU - lecture Impacteur » (Email interview).
//   … | node scripts/impacteur-adresse.js ranger   -> lit l'adresse sur l'entrée standard (jamais affichée)
//   node scripts/impacteur-adresse.js essai         -> lit les fiches une fois et affiche seulement des totaux
//   node scripts/impacteur-adresse.js retirer       -> débranche le relevé
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { WEBHOOK_RE, lireFiches } from '../server/releve-impacteur.js';

const file = join(process.env.DATA_DIR || './data', 'impacteur.json');
const cmd = process.argv[2];

if (cmd === 'ranger') {
  let input = '';
  for await (const c of process.stdin) input += c;
  const url = input.trim().split(/\s+/)[0] || '';
  if (!WEBHOOK_RE.test(url)) {
    console.log('Adresse refusée : elle doit être https://n8n.nourmeet.com/webhook/cerveau-impacteur-<32 caractères>.');
    process.exit(1);
  }
  writeFileSync(file + '.tmp', JSON.stringify({ url, range: new Date().toISOString() }), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  chmodSync(file, 0o600);
  console.log('Adresse d’Impacteur rangée. Loop Agent relèvera les invitations chaque heure.');
} else if (cmd === 'essai') {
  if (!existsSync(file)) {
    console.log('Aucune adresse rangée.');
    process.exit(1);
  }
  const { url } = JSON.parse(readFileSync(file, 'utf8'));
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  console.log(`n8n répond ${r.status}`);
  if (!r.ok) process.exit(1);
  const lu = lireFiches(await r.json());
  const envoyees = lu.fiches.filter((f) => f.envoi).length;
  const types = {};
  for (const f of lu.fiches) if (f.type) types[f.type] = (types[f.type] || 0) + 1;
  const derniere = lu.fiches.map((f) => f.envoi).filter(Boolean).sort().pop();
  console.log(`${lu.fiches.length} fiches · ${envoyees} invitations envoyées (dernière le ${derniere || '—'}) · réponses mesurées : ${lu.reponsesMesurees ? 'oui' : 'non'} · types : ${JSON.stringify(types)}`);
} else if (cmd === 'retirer') {
  if (existsSync(file)) unlinkSync(file);
  console.log('Relevé d’Impacteur débranché.');
} else {
  console.log('Usage : ranger (adresse sur l’entrée standard) | essai | retirer');
  process.exitCode = 1;
}
