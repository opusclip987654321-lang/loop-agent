import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PROJECTS, isValidDocKey } from './projects.js';
import { verifyPassword, newSessionToken, tokenHash, createLoginLimiter } from './auth.js';
import { createMcpHandler } from './mcp.js';
import { createAgentTools, CONNECTOR_INSTRUCTIONS } from './agent-tools.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const COOKIE = 'la_session';
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Pages accessibles sans être connecté.
const PUBLIC_PATHS = new Set(['/login', '/healthz', '/style.css', '/favicon.svg']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  // La maquette utilise des onclick="…" dans le HTML généré : 'unsafe-inline'
  // reste nécessaire pour les scripts. Tout le texte affiché passe par esc().
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function detectFileType(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: 'image/png', ext: '.png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
    return { mime: 'image/webp', ext: '.webp' };
  return null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Trop volumineux.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = MAX_DOC_BYTES + 1024) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('application/json')) throw new HttpError(415, 'JSON attendu.');
  try {
    return JSON.parse((await readBody(req, limit)).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'JSON invalide.');
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    ...headers,
  });
  res.end(payload);
}

export function createApp({
  db,
  dataDir,
  passwordHash,
  cookieSecure = false,
  trustProxy = false,
  sessionDays = 30,
  onAgentWrite = () => {},
  onToolDone = () => {},
}) {
  if (!passwordHash) throw new Error('LOOP_AGENT_PASSWORD_HASH manquant : lance « npm run hash-password ».');
  const limiter = createLoginLimiter();
  const filesDir = join(dataDir, 'files');
  const sessionMs = sessionDays * 24 * 3600 * 1000;

  // Connecteur des agents (claude.ai) : clé dans l'en-tête Authorization,
  // rangée par claude.ai, jamais dans les consignes des projets.
  const keyLimiter = createLoginLimiter({ max: 20 });
  const mcp = createMcpHandler({
    name: 'loop-agent',
    version: '1.0.0',
    instructions: CONNECTOR_INSTRUCTIONS,
    tools: createAgentTools({ db, dataDir, onAgentWrite, onToolDone }),
  });

  function agentKeyFrom(req) {
    const h = String(req.headers.authorization || '');
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    return m ? m[1] : null;
  }

  function clientIp(req) {
    if (trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'inconnu';
  }

  function sessionCookie(value, maxAgeSec) {
    return [
      `${COOKIE}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSec}`,
      ...(cookieSecure ? ['Secure'] : []),
    ].join('; ');
  }

  function isAuthed(req) {
    const tok = parseCookies(req.headers.cookie)[COOKIE];
    return !!tok && db.sessionValid(tokenHash(tok), Date.now());
  }

  // Refuse les écritures venues d'un autre site (en plus du SameSite=Strict).
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Origine refusée.');
    }
    const expected = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
    if (host !== expected) throw new HttpError(403, 'Origine refusée.');
  }

  async function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : urlPath === '/login' ? 'login.html' : urlPath.slice(1);
    const full = normalize(join(PUBLIC_DIR, rel));
    if (!full.startsWith(PUBLIC_DIR) || full.includes(`${sep}.`)) throw new HttpError(404, 'Introuvable.');
    let content;
    try {
      content = await readFile(full);
    } catch {
      throw new HttpError(404, 'Introuvable.');
    }
    const type = MIME[extname(full)] || 'application/octet-stream';
    send(res, 200, content, {
      'Content-Type': type,
      'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'no-cache',
    });
  }

  async function handleApi(req, res, path) {
    const method = req.method;

    if (path === '/api/login' && method === 'POST') {
      checkOrigin(req);
      const ip = clientIp(req);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Trop d’essais. Réessaie dans 15 minutes.');
      const { password } = await readJson(req, 4096);
      if (!verifyPassword(password, passwordHash)) {
        limiter.fail(ip);
        throw new HttpError(401, 'Mot de passe incorrect.');
      }
      limiter.reset(ip);
      const token = newSessionToken();
      const now = Date.now();
      db.purgeSessions(now);
      db.addSession(tokenHash(token), now, now + sessionMs);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, Math.floor(sessionMs / 1000)) });
    }

    if (!isAuthed(req)) throw new HttpError(401, 'Connexion requise.');

    if (path === '/api/logout' && method === 'POST') {
      checkOrigin(req);
      const tok = parseCookies(req.headers.cookie)[COOKIE];
      if (tok) db.deleteSession(tokenHash(tok));
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (path === '/api/state' && method === 'GET') {
      const docs = {};
      for (const d of db.allDocs()) docs[d.key] = { value: d.value, version: d.version };
      return send(res, 200, { projects: PROJECTS, docs });
    }

    if (path === '/api/versions' && method === 'GET') return send(res, 200, db.versions());


    const docMatch = /^\/api\/docs\/([^/]+)$/.exec(path);
    if (docMatch) {
      const key = decodeURIComponent(docMatch[1]);
      if (!isValidDocKey(key)) throw new HttpError(404, 'Document inconnu.');
      if (method === 'GET') {
        const d = db.getDoc(key);
        return send(res, 200, d ? { value: d.value, version: d.version } : { value: null, version: 0 });
      }
      if (method === 'PUT') {
        checkOrigin(req);
        const body = await readJson(req);
        if (typeof body.value !== 'string' || !Number.isInteger(body.base) || body.base < 0)
          throw new HttpError(400, 'Format attendu : { value, base }.');
        if (Buffer.byteLength(body.value) > MAX_DOC_BYTES) throw new HttpError(413, 'Document trop volumineux.');
        let parsed;
        try {
          parsed = JSON.parse(body.value);
        } catch {
          throw new HttpError(400, 'Le document doit être du JSON.');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new HttpError(400, 'Le document doit être un objet JSON.');
        const r = db.putDoc(key, body.value, body.base, 'walid');
        if (!r.ok)
          return send(res, 409, {
            error: 'Version périmée : le document a changé entre-temps.',
            value: r.current ? r.current.value : null,
            version: r.current ? r.current.version : 0,
          });
        return send(res, 200, { version: r.version });
      }
      throw new HttpError(405, 'Méthode non permise.');
    }

    if (path === '/api/files' && method === 'POST') {
      checkOrigin(req);
      const buf = await readBody(req, MAX_FILE_BYTES);
      const type = detectFileType(buf);
      if (!type) throw new HttpError(415, 'Format accepté : PDF, PNG, JPG ou WebP.');
      let name = 'facture';
      try {
        name = decodeURIComponent(String(req.headers['x-file-name'] || 'facture'));
      } catch {}
      name = name.replace(/[\u0000-\u001f\\/]/g, '_').slice(0, 160) || 'facture';
      const id = randomBytes(12).toString('hex');
      await mkdir(filesDir, { recursive: true });
      await writeFile(join(filesDir, id), buf, { flag: 'wx' });
      db.addFile({ id, name, mime: type.mime, size: buf.length });
      return send(res, 201, { id, name, mime: type.mime, size: buf.length });
    }

    const fileMatch = /^\/api\/files\/([a-f0-9]{24})$/.exec(path);
    if (fileMatch) {
      const f = db.getFile(fileMatch[1]);
      if (!f) throw new HttpError(404, 'Fichier introuvable.');
      if (method === 'GET') {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Content-Type': f.mime,
          'Content-Length': f.size,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          'Cache-Control': 'private, no-store',
        });
        return createReadStream(join(filesDir, f.id)).pipe(res);
      }
      if (method === 'DELETE') {
        checkOrigin(req);
        db.deleteFile(f.id);
        await unlink(join(filesDir, f.id)).catch(() => {});
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Méthode non permise.');
    }

    throw new HttpError(404, 'Introuvable.');
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    try {
      if (path === '/healthz') return send(res, 200, { ok: true });
      // Pas d'OAuth : la connexion se fait par une clé dans l'en-tête. On répond
      // clairement « rien ici » (404) aux recherches de configuration OAuth.
      if (path.startsWith('/.well-known/')) throw new HttpError(404, 'Introuvable.');
      if (path === '/mcp') {
        if (req.method !== 'POST') throw new HttpError(405, 'POST uniquement.');
        const origin = req.headers.origin;
        if (origin && !/^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)$/.test(origin))
          throw new HttpError(403, 'Origine refusée.');
        const ip = clientIp(req);
        if (keyLimiter.blocked(ip)) throw new HttpError(429, 'Trop d’essais.');
        const key = agentKeyFrom(req);
        const agent = key ? db.findAgentKey(tokenHash(key)) : null;
        if (!agent) {
          keyLimiter.fail(ip);
          throw new HttpError(401, 'Clé d’agent manquante ou invalide.');
        }
        const { status, body } = await mcp(await readJson(req, 1024 * 1024), { agent });
        if (body === null) {
          res.writeHead(202, SECURITY_HEADERS);
          return res.end();
        }
        return send(res, status, body);
      }
      if (path.startsWith('/api/')) return await handleApi(req, res, path);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non permise.');
      if (!PUBLIC_PATHS.has(path) && !isAuthed(req)) {
        if (path === '/' || path.endsWith('.html')) {
          res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
          return res.end();
        }
        throw new HttpError(401, 'Connexion requise.');
      }
      if (path === '/login' && isAuthed(req)) {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        return res.end();
      }
      return await serveStatic(res, path);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(new Date().toISOString(), req.method, path, e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erreur interne.' : e.message });
      else res.end();
    }
  };
}
