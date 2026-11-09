// Accès Patreon pour le relevé d'Impacteur Communauté.
//   node scripts/patreon-jeton.js ranger   -> demande les 4 informations du client Patreon (rien ne s'affiche)
//   node scripts/patreon-jeton.js essai    -> lit Patreon une fois et affiche seulement des totaux
//   node scripts/patreon-jeton.js retirer  -> débranche le relevé
// À lancer avec : ssh -t loop-agent-vps 'docker exec -it loop-agent node scripts/patreon-jeton.js ranger'
import { writeFileSync, renameSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createRelevePatreon } from '../server/releve-patreon.js';

const dataDir = process.env.DATA_DIR || './data';
const file = join(dataDir, 'patreon.json');
const cmd = process.argv[2];

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let buf = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
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

if (cmd === 'ranger') {
  console.log('Colle chaque information depuis la page « Clients & API Keys » de Patreon. Rien ne s’affiche quand tu colles, c’est normal.');
  const client_id = await ask('1/4 Client ID : ');
  const client_secret = await ask('2/4 Client Secret : ');
  const access_token = await ask('3/4 Creator’s Access Token : ');
  const refresh_token = await ask('4/4 Creator’s Refresh Token : ');
  if ([client_id, client_secret, access_token, refresh_token].some((x) => x.length < 8 || /\s/.test(x))) {
    console.log('Une des 4 informations est vide ou mal copiée : rien n’est rangé. Recommence.');
    process.exit(1);
  }
  writeFileSync(file + '.tmp', JSON.stringify({ client_id, client_secret, access_token, refresh_token, range: new Date().toISOString() }), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  chmodSync(file, 0o600);
  console.log('Accès Patreon rangé. Loop Agent relèvera tes membres toutes les 3 heures.');
} else if (cmd === 'essai') {
  if (!existsSync(file)) {
    console.log('Aucun accès rangé.');
    process.exit(1);
  }
  const db = openDb(dataDir);
  try {
    const lu = await createRelevePatreon({ db, dataDir }).lireTout();
    const arr = Object.entries(lu.arrivees).sort().slice(-5).map(([d, n]) => `${d}: ${n}`).join(', ');
    console.log(`Patreon répond : ${lu.actifs} membre(s) actif(s), ${lu.revenusMois} par mois au total · dernières arrivées : ${arr || 'aucune'}`);
    console.log(`Fiches lues chez Patreon : ${lu.lus} · par statut : ${JSON.stringify(lu.statuts)}`);
  } catch (e) {
    console.log('Échec : ' + e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
} else if (cmd === 'retirer') {
  if (existsSync(file)) unlinkSync(file);
  console.log('Relevé Patreon débranché.');
} else {
  console.log('Usage : ranger | essai | retirer');
  process.exitCode = 1;
}
