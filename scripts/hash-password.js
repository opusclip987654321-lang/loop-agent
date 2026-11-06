// Demande un mot de passe (sans l'afficher) et produit son empreinte.
// Usage :
//   npm run hash-password                       -> affiche la ligne à coller dans .env
//   node scripts/hash-password.js --write .env  -> écrit la ligne dans ce fichier
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashPassword } from '../server/auth.js';

function ask(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const writeIdx = process.argv.indexOf('--write');
const target = writeIdx > 0 ? process.argv[writeIdx + 1] : null;

const a = await ask('Mot de passe Loop Agent (12 caractères minimum) : ');
if (a.length < 12) {
  console.error('Trop court : 12 caractères minimum.');
  process.exit(1);
}
const b = await ask('Encore une fois : ');
if (a !== b) {
  console.error('Les deux saisies ne correspondent pas.');
  process.exit(1);
}
const line = `LOOP_AGENT_PASSWORD_HASH='${hashPassword(a)}'`;

if (target) {
  const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const kept = before.split('\n').filter((l) => !l.startsWith('LOOP_AGENT_PASSWORD_HASH='));
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  writeFileSync(target, [...kept, line, ''].join('\n'), { mode: 0o600 });
  console.log(`\nC’est enregistré dans ${target}. Le mot de passe lui-même n’est écrit nulle part.`);
} else {
  console.log('\nColle cette ligne dans le fichier .env du serveur :\n');
  console.log(line);
}
