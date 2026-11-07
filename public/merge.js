// Fusion à trois versions d'un document Loop Agent.
// Utilisée quand Walid et un agent ont écrit le même document en même temps :
// base = ce que l'écran avait lu, mine = la version de Walid, theirs = celle
// du serveur (écrite par l'agent). On garde les deux séries de changements.
//
// Règles :
// - objets : fusion clé par clé ;
// - listes d'objets avec « id » : fusion élément par élément (ajouts des deux
//   côtés gardés, suppression d'un côté appliquée) ;
// - autres valeurs : celle qui a changé l'emporte ; si les deux ont changé
//   différemment, Walid l'emporte (c'est lui qui décide).
(function (root) {
  'use strict';

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isIdList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && typeof x.id === 'string');
  const idList = (...vs) => vs.every((v) => v === undefined || (Array.isArray(v) && (v.length === 0 || isIdList(v))))
    && vs.some(isIdList);

  function merge3(base, mine, theirs) {
    if (same(mine, theirs)) return theirs;
    if (same(base, mine)) return theirs;
    if (same(base, theirs)) return mine;
    if (isObj(mine) && isObj(theirs)) return mergeObj(isObj(base) ? base : {}, mine, theirs);
    if (Array.isArray(mine) && Array.isArray(theirs) && idList(base, mine, theirs))
      return mergeList(Array.isArray(base) ? base : [], mine, theirs);
    return mine;
  }

  function mergeObj(base, mine, theirs) {
    const out = {};
    const keys = new Set([...Object.keys(theirs), ...Object.keys(mine)]);
    for (const k of keys) {
      const inB = Object.prototype.hasOwnProperty.call(base, k);
      const inM = Object.prototype.hasOwnProperty.call(mine, k);
      const inT = Object.prototype.hasOwnProperty.call(theirs, k);
      if (inM && inT) out[k] = merge3(base[k], mine[k], theirs[k]);
      else if (inM) {
        // Absent chez l'agent : supprimé par lui, sauf si Walid l'a ajouté ou modifié.
        if (!inB || !same(base[k], mine[k])) out[k] = mine[k];
      } else if (inT) {
        if (!inB || !same(base[k], theirs[k])) out[k] = theirs[k];
      }
    }
    return out;
  }

  function mergeList(base, mine, theirs) {
    const byId = (list) => new Map(list.map((x) => [x.id, x]));
    const b = byId(base);
    const m = byId(mine);
    const t = byId(theirs);
    const out = [];
    const keep = (id) => {
      const inB = b.has(id), inM = m.has(id), inT = t.has(id);
      if (inM && inT) return merge3(b.get(id), m.get(id), t.get(id));
      if (inM) return !inB || !same(b.get(id), m.get(id)) ? m.get(id) : undefined;
      if (inT) return !inB || !same(b.get(id), t.get(id)) ? t.get(id) : undefined;
      return undefined;
    };
    const seen = new Set();
    // Ordre de l'agent, puis ce que Walid a ajouté, à sa place relative.
    for (const x of theirs) {
      seen.add(x.id);
      const v = keep(x.id);
      if (v !== undefined) out.push(v);
    }
    mine.forEach((x, i) => {
      if (seen.has(x.id)) return;
      seen.add(x.id);
      const v = keep(x.id);
      if (v === undefined) return;
      // Place après l'élément qui le précède chez Walid, sinon en tête.
      const prev = i > 0 ? mine[i - 1].id : null;
      const at = prev === null ? 0 : out.findIndex((y) => y.id === prev) + 1;
      out.splice(at > 0 || prev === null ? at : out.length, 0, v);
    });
    return out;
  }

  // Sur des chaînes JSON. Renvoie la chaîne fusionnée, ou null si impossible.
  function mergeDocs(baseStr, mineStr, theirsStr) {
    try {
      const base = baseStr == null ? {} : JSON.parse(baseStr);
      const mine = JSON.parse(mineStr);
      const theirs = theirsStr == null ? {} : JSON.parse(theirsStr);
      return JSON.stringify(merge3(base, mine, theirs));
    } catch {
      return null;
    }
  }

  root.LAMerge = { merge3, mergeDocs };
})(typeof window !== 'undefined' ? window : globalThis);
