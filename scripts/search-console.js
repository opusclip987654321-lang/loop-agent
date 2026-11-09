// Relevé Search Console : node scripts/search-console.js essai  -> lit Google une fois et affiche seulement des totaux
//                         node scripts/search-console.js retirer -> efface la clé du compte de service
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createReleveSearchConsole } from '../server/releve-search-console.js';

const dataDir = process.env.DATA_DIR || './data';
const file = join(dataDir, 'search-console.json');
const cmd = process.argv[2];
if (cmd === 'essai') {
  if (!existsSync(file)) {
    console.log('Aucune clé rangée.');
    process.exit(1);
  }
  const db = openDb(dataDir);
  try {
    const lus = await createReleveSearchConsole({ db, dataDir }).lireTout();
    if (!lus.length) console.log('Google répond, mais aucun site n’est partagé avec le compte de service (ou site inconnu de Loop Agent).');
    for (const l of lus) console.log(`${l.site} → ${l.projet} : sur 28 jours ${l.sur28jours.clics} clic(s), ${l.sur28jours.affichages} affichage(s) ; ${l.parJour.length} jour(s) avec des données.`);
  } catch (e) {
    console.log('Échec : ' + e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
} else if (cmd === 'retirer') {
  if (existsSync(file)) unlinkSync(file);
  console.log('Relevé Search Console débranché.');
} else {
  console.log('Usage : essai | retirer');
  process.exitCode = 1;
}
