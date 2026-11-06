import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// Mot de passe : on ne garde que son empreinte scrypt, au format
//   scrypt:N:r:p:sel(base64):empreinte(base64)
// (pas de « $ », que Docker Compose interpréterait comme une variable)
// L'empreinte est posée dans le .env du serveur par Walid lui-même
// (npm run hash-password), jamais dans le code.

const KEYLEN = 64;

export function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':');
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  let got;
  try {
    got = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Limite les essais de mot de passe : au-delà de MAX échecs en WINDOW,
// l'adresse est bloquée jusqu'à la fin de la fenêtre.
export function createLoginLimiter({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map();
  return {
    blocked(ip, now = Date.now()) {
      const f = fails.get(ip);
      if (!f) return false;
      if (now - f.first > windowMs) {
        fails.delete(ip);
        return false;
      }
      return f.count >= max;
    },
    fail(ip, now = Date.now()) {
      const f = fails.get(ip);
      if (!f || now - f.first > windowMs) fails.set(ip, { first: now, count: 1 });
      else f.count++;
    },
    reset(ip) {
      fails.delete(ip);
    },
  };
}
