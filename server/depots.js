// Dépôts de fichiers par les agents (images, PDF) pour les joindre à une demande à Walid.
// L'agent appelle l'outil preparer_depot : il reçoit une adresse à usage unique, valable
// 30 minutes, où il envoie son fichier (curl -X PUT --data-binary @fichier <adresse>).
// La réponse donne l'identifiant du fichier, à citer dans demander_a_walid (pieces).
// Les fichiers déposés se voient seulement par Walid connecté (/api/files/<id>).
import { randomBytes } from 'node:crypto';

const depots = new Map(); // jeton → { projet, expire }
const DUREE = 30 * 60 * 1000;

export function creerDepot(projet, now = Date.now()) {
  for (const [k, v] of depots) if (v.expire < now) depots.delete(k);
  const jeton = randomBytes(18).toString('hex');
  depots.set(jeton, { projet, expire: now + DUREE });
  return jeton;
}

// Consomme le jeton (une seule fois). Renvoie le projet, ou null.
export function prendreDepot(jeton, now = Date.now()) {
  const d = depots.get(jeton);
  depots.delete(jeton);
  return d && d.expire >= now ? d.projet : null;
}

export const DEPOT_RE = /^\/depot\/([0-9a-f]{36})$/;
