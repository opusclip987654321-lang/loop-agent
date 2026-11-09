// Import unique de l'historique Notion des loops dans Loop Agent (09/11/2026, avant l'arrêt du
// cerveau central). Lit sur l'entrée standard le JSON de scripts/notion-export.py et range,
// dans chaque projet, son archive Notion : décisions et leçons datées, page complète du projet,
// lignes « Fait pour Walid ». Relançable : l'archive d'un projet est remplacée, rien d'autre.
//   python3 notion-export.py | ssh loop-agent-vps 'docker exec -i loop-agent node scripts/import-notion.js'
import { openDb } from '../server/db.js';
import { archiveParProjet } from '../server/archive-notion.js';

const dataDir = process.env.DATA_DIR || './data';
let input = '';
for await (const c of process.stdin) input += c;
let src;
try {
  src = JSON.parse(input);
} catch {
  console.log('Entrée illisible : il faut le JSON de notion-export.py.');
  process.exit(1);
}
const parProjet = archiveParProjet(src);
const db = openDb(dataDir);
try {
  for (const [id, archive] of Object.entries(parProjet)) {
    let ok = false;
    for (let i = 0; i < 5 && !ok; i++) {
      const cur = db.getDoc('project:' + id);
      if (!cur) {
        console.log(`${id} : projet absent de Loop Agent, ignoré.`);
        break;
      }
      const doc = JSON.parse(cur.value);
      doc.archiveNotion = archive;
      ok = db.putDoc('project:' + id, JSON.stringify(doc), cur.version, 'walid').ok;
    }
    if (ok) console.log(`${id} : ${archive.decisions.length} décision(s) et leçon(s), ${archive.pages.length} page(s), ${archive.fait.length} ligne(s) « fait ».`);
  }
} finally {
  db.close();
}
