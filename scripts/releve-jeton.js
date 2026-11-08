// Jeton du relevé Nūr Meet (le programme du serveur de Nūr l'utilise pour envoyer ses chiffres).
//   node scripts/releve-jeton.js creer   -> crée un jeton, garde son empreinte, et l'écrit UNE fois
//                                         sur la sortie standard (à envoyer directement au serveur de Nūr)
//   node scripts/releve-jeton.js etat    -> dit si un jeton existe (sans le montrer)
// Créer un nouveau jeton annule l'ancien.
import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync, renameSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.env.DATA_DIR || './data', 'releve-nour.json');
const cmd = process.argv[2];
if (cmd === 'creer') {
  const jeton = 'rn_' + randomBytes(32).toString('base64url');
  writeFileSync(file + '.tmp', JSON.stringify({ empreinte: createHash('sha256').update(jeton).digest('hex'), cree: new Date().toISOString() }), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  chmodSync(file, 0o600);
  process.stdout.write(jeton + '\n');
} else if (cmd === 'etat') {
  console.log(existsSync(file) ? `Jeton créé le ${JSON.parse(readFileSync(file, 'utf8')).cree}.` : 'Aucun jeton.');
} else {
  console.log('Usage : creer | etat');
  process.exitCode = 1;
}
