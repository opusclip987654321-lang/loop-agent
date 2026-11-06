// Demande un mot de passe (sans l'afficher) et imprime la ligne à coller dans .env.
// Usage : npm run hash-password
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

const a = await ask('Mot de passe Loop Agent : ');
if (a.length < 12) {
  console.error('Trop court : 12 caractères minimum.');
  process.exit(1);
}
const b = await ask('Encore une fois : ');
if (a !== b) {
  console.error('Les deux saisies ne correspondent pas.');
  process.exit(1);
}
console.log('\nColle cette ligne dans le fichier .env du serveur :\n');
console.log(`LOOP_AGENT_PASSWORD_HASH='${hashPassword(a)}'`);
