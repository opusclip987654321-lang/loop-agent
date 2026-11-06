import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Une seule base SQLite dans DATA_DIR. Chaque projet est un document JSON
// versionné : une écriture doit annoncer la version qu'elle a lue, sinon elle
// est refusée (409) pour ne jamais écraser ce qu'un agent vient d'écrire.

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'loop-agent.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS docs (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      version    INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash    TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      mime       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const q = {
    getDoc: db.prepare('SELECT value, version FROM docs WHERE key = ?'),
    allDocs: db.prepare('SELECT key, value, version FROM docs'),
    versions: db.prepare('SELECT key, version FROM docs'),
    insertDoc: db.prepare(
      'INSERT INTO docs (key, value, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)'
    ),
    updateDoc: db.prepare(
      'UPDATE docs SET value = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE key = ? AND version = ?'
    ),
    addSession: db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)'),
    getSession: db.prepare('SELECT expires_at FROM sessions WHERE id_hash = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    addFile: db.prepare('INSERT INTO files (id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)'),
    getFile: db.prepare('SELECT id, name, mime, size FROM files WHERE id = ?'),
    delFile: db.prepare('DELETE FROM files WHERE id = ?'),
  };

  return {
    raw: db,
    getDoc(key) {
      return q.getDoc.get(key) || null;
    },
    allDocs() {
      return q.allDocs.all();
    },
    versions() {
      const out = {};
      for (const r of q.versions.all()) out[r.key] = r.version;
      return out;
    },
    // Écrit si la version lue (base) est toujours la bonne.
    // Renvoie { ok: true, version } ou { ok: false, current }.
    putDoc(key, value, base, by) {
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const cur = q.getDoc.get(key);
        if (!cur) {
          if (base !== 0) {
            db.exec('ROLLBACK');
            return { ok: false, current: null };
          }
          q.insertDoc.run(key, value, now, by);
          db.exec('COMMIT');
          return { ok: true, version: 1 };
        }
        if (cur.version !== base) {
          db.exec('ROLLBACK');
          return { ok: false, current: cur };
        }
        q.updateDoc.run(value, now, by, key, base);
        db.exec('COMMIT');
        return { ok: true, version: base + 1 };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    addSession(idHash, createdAt, expiresAt) {
      q.addSession.run(idHash, createdAt, expiresAt);
    },
    sessionValid(idHash, now) {
      const r = q.getSession.get(idHash);
      return !!r && r.expires_at > now;
    },
    deleteSession(idHash) {
      q.delSession.run(idHash);
    },
    purgeSessions(now) {
      q.purgeSessions.run(now);
    },
    addFile(f) {
      q.addFile.run(f.id, f.name, f.mime, f.size, new Date().toISOString());
    },
    getFile(id) {
      return q.getFile.get(id) || null;
    },
    deleteFile(id) {
      q.delFile.run(id);
    },
    close() {
      db.close();
    },
  };
}
