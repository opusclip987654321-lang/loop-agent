// Méthode de la loop Nūr Meet restaurateurs (reprise du cerveau central).
// Les workflows n8n « Nour Meet 1 » (9 h, repêchage 11 h 07) et « Nour Meet 3 » (9 h 30)
// la lisent chaque matin à une adresse secrète. Le format est EXACTEMENT celui du cerveau
// (src/loop-nour-meet.js, methodePourN8n) : la méthode + { pause }.
// Si l'adresse ne répond pas, n8n repart sur ses textes d'origine (v1) : rien ne s'arrête.
// Tout est dans DATA_DIR/nour-methode.json (droits 600) : secret de l'adresse, méthode en cours,
// historique des versions (copie complète, pour pouvoir revenir en arrière).

import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export const ROUTE_RE = /^\/loop\/nour-meet\/([0-9a-f]{32})$/;

export function fichier(dataDir) {
  return join(dataDir, 'nour-methode.json');
}
export function charger(dataDir) {
  try {
    return JSON.parse(readFileSync(fichier(dataDir), 'utf8'));
  } catch {
    return null;
  }
}
export function enregistrer(dataDir, etat) {
  const f = fichier(dataDir);
  writeFileSync(f + '.tmp', JSON.stringify(etat, null, 2), { mode: 0o600 });
  renameSync(f + '.tmp', f);
  chmodSync(f, 0o600);
}

// Ce que n8n reçoit : la méthode en cours, rien d'autre (même forme que le cerveau).
export const pourN8n = (etat) => ({ ...etat.methode, pause: Boolean(etat.pause) });

// Contrôle minimal avant d'accepter une méthode (n8n ignore une méthode sans version ni textes).
export function verifier(m) {
  const err = [];
  if (!m || typeof m !== 'object') return ['méthode absente'];
  if (!Number.isInteger(m.version) || m.version < 1) err.push('version manquante');
  for (const t of ['initial', 'relance1', 'relance2']) {
    const x = m.textes && m.textes[t];
    if (!x || typeof x.objet !== 'string' || typeof x.corps !== 'string' || !x.objet.trim() || !x.corps.trim()) err.push(`texte « ${t} » incomplet`);
    else if (!x.corps.includes('{lien}') || !x.corps.includes('{pied}')) err.push(`texte « ${t} » sans {lien} ou {pied}`);
    else if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(x.objet + x.corps)) err.push(`texte « ${t} » contient une adresse mail`);
  }
  if (!Array.isArray(m.recherches) || m.recherches.length < 1 || m.recherches.length > 10) err.push('recherches : 1 à 10');
  if (!Array.isArray(m.relanceJours) || m.relanceJours.length !== 2 || !(m.relanceJours[0] >= 2 && m.relanceJours[0] < m.relanceJours[1] && m.relanceJours[1] <= 30))
    err.push('relanceJours : deux nombres entre 2 et 30, croissants');
  if (!(m.parJour >= 10 && m.parJour <= 80)) err.push('parJour : entre 10 et 80');
  return err;
}

// La route publique (adresse secrète). Renvoie true si elle a répondu.
export function servir(dataDir, path, res) {
  const m = ROUTE_RE.exec(path);
  if (!m) return false;
  const etat = charger(dataDir);
  const ok =
    etat &&
    typeof etat.secret === 'string' &&
    etat.secret.length === m[1].length &&
    timingSafeEqual(Buffer.from(etat.secret), Buffer.from(m[1])) &&
    etat.methode;
  if (!ok) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Introuvable.');
    return true;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(pourN8n(etat)));
  return true;
}
