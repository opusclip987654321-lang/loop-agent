// Gestion des clés du connecteur des agents.
//   node scripts/agent-key.js creer "claude.ai"   -> crée une clé et l'affiche UNE fois
//   node scripts/agent-key.js liste               -> liste les clés (sans les montrer)
//   node scripts/agent-key.js annuler <id>        -> annule une clé
// Seule l'empreinte de la clé est gardée dans la base.
import { randomBytes } from 'node:crypto';
import { openDb } from '../server/db.js';
import { tokenHash } from '../server/auth.js';

const db = openDb(process.env.DATA_DIR || './data');
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'creer') {
  const label = (arg || 'claude.ai').slice(0, 60);
  const id = 'cle-' + randomBytes(3).toString('hex');
  const key = 'la_' + randomBytes(32).toString('base64url');
  db.addAgentKey(id, label, tokenHash(key));
  console.log(`
Clé « ${label} » créée (identifiant ${id}).

Dans claude.ai, connecteur Loop Agent → En-têtes de requête → Ajouter un en-tête :
  Nom    : Authorization
  Valeur : Bearer ${key}

Elle ne sera plus jamais affichée. Ne la colle nulle part ailleurs.
`);
} else if (cmd === 'liste') {
  for (const k of db.listAgentKeys())
    console.log(`${k.id}  ${k.label}  créée ${k.created_at}  dernier usage ${k.last_used || 'jamais'}${k.revoked_at ? '  ANNULÉE ' + k.revoked_at : ''}`);
} else if (cmd === 'annuler' && arg) {
  console.log(db.revokeAgentKey(arg) ? `Clé ${arg} annulée.` : `Aucune clé active ${arg}.`);
} else {
  console.log('Usage : creer "nom" | liste | annuler <id>');
  process.exitCode = 1;
}
db.close();
