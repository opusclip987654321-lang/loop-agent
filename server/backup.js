// Sauvegardes nocturnes, faites par le serveur lui-même (pas de cron à installer).
// Chaque nuit à l'heure dite : copie cohérente de la base dans
// DATA_DIR/backups/loop-agent-AAAA-MM-JJ.sqlite, on garde les `keep` dernières.
// Les factures (DATA_DIR/files) ne changent jamais une fois déposées : elles sont
// recopiées dans DATA_DIR/backups/files si elles n'y sont pas encore.
// Le Mac récupère ensuite tout le dossier backups (scripts/sauvegarde-mac.sh).

import { mkdirSync, readdirSync, rmSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^loop-agent-(\d{4}-\d{2}-\d{2})\.sqlite$/;

function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function runBackup({ db, dataDir, keep = 14, now = new Date() }) {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `loop-agent-${localDate(now)}.sqlite`);
  const tmp = file + '.tmp';
  rmSync(tmp, { force: true });
  db.backupTo(tmp);
  renameSync(tmp, file);

  // Factures
  const src = join(dataDir, 'files');
  let copied = 0;
  if (existsSync(src)) {
    const dst = join(dir, 'files');
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(src)) {
      if (!existsSync(join(dst, f))) {
        copyFileSync(join(src, f), join(dst, f));
        copied++;
      }
    }
  }

  // Rotation : on garde les `keep` plus récentes.
  const all = readdirSync(dir).filter((f) => NAME.test(f)).sort();
  const removed = all.slice(0, Math.max(0, all.length - keep));
  for (const f of removed) rmSync(join(dir, f), { force: true });

  return { file, kept: all.length - removed.length, removed: removed.length, filesCopied: copied };
}

// Lance la sauvegarde une fois par jour, à partir de `hour` (heure du serveur).
// Rattrape au démarrage si la sauvegarde du jour manque et que l'heure est passée.
export function scheduleBackups({ db, dataDir, keep = 14, hour = 3, log = console }) {
  function due(now = new Date()) {
    if (now.getHours() < hour) return false;
    return !existsSync(join(dataDir, 'backups', `loop-agent-${localDate(now)}.sqlite`));
  }
  function tick() {
    if (!due()) return;
    try {
      const r = runBackup({ db, dataDir, keep });
      log.log(new Date().toISOString(), 'sauvegarde', r.file, `gardées ${r.kept}`, `factures copiées ${r.filesCopied}`);
    } catch (e) {
      log.error(new Date().toISOString(), 'sauvegarde ÉCHOUÉE', String(e.message || e));
    }
  }
  tick();
  const t = setInterval(tick, 10 * 60 * 1000);
  t.unref();
  return () => clearInterval(t);
}
