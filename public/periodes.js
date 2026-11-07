// Périodes de la page Résultats : semaine, mois, trimestre, semestre, année.
// Partagé par le site et le serveur (outils des agents).
// Clés : 2026-W45 (semaine ISO), 2026-11, 2026-Q4, 2026-H2, 2026.
(function (root) {
  'use strict';

  const GRANS = ['semaine', 'mois', 'trimestre', 'semestre', 'annee'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function parse(d) {
    if (d instanceof Date) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function isoWeek(dt) {
    const d = new Date(dt.getTime());
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return { y, w };
  }
  const pad = (n) => String(n).padStart(2, '0');

  function periodKey(date, gran) {
    const d = parse(date);
    if (!d) return null;
    const y = d.getUTCFullYear(),
      m = d.getUTCMonth();
    if (gran === 'semaine') {
      const { y: wy, w } = isoWeek(d);
      return `${wy}-W${pad(w)}`;
    }
    if (gran === 'mois') return `${y}-${pad(m + 1)}`;
    if (gran === 'trimestre') return `${y}-Q${Math.floor(m / 3) + 1}`;
    if (gran === 'semestre') return `${y}-H${m < 6 ? 1 : 2}`;
    if (gran === 'annee') return String(y);
    return null;
  }

  // Premier jour d'une période (Date UTC).
  function start(key, gran) {
    if (gran === 'semaine') {
      const [y, w] = key.split('-W').map(Number);
      const jan4 = new Date(Date.UTC(y, 0, 4));
      const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000);
      return new Date(mon.getTime() + (w - 1) * 7 * 86400000);
    }
    const y = Number(key.slice(0, 4));
    if (gran === 'mois') return new Date(Date.UTC(y, Number(key.slice(5, 7)) - 1, 1));
    if (gran === 'trimestre') return new Date(Date.UTC(y, (Number(key.slice(6)) - 1) * 3, 1));
    if (gran === 'semestre') return new Date(Date.UTC(y, key.endsWith('H2') ? 6 : 0, 1));
    return new Date(Date.UTC(y, 0, 1));
  }
  function prevKey(key, gran) {
    const s = start(key, gran);
    return periodKey(new Date(s.getTime() - 86400000).toISOString().slice(0, 10), gran);
  }
  // Les n dernières périodes, de la plus ancienne à celle en cours.
  function lastKeys(gran, n, now = new Date()) {
    const out = [periodKey(now.toISOString().slice(0, 10), gran)];
    while (out.length < n) out.unshift(prevKey(out[0], gran));
    return out;
  }
  function label(key, gran) {
    if (gran === 'semaine') {
      const s = start(key, gran);
      return `sem. du ${pad(s.getUTCDate())}/${pad(s.getUTCMonth() + 1)}`;
    }
    if (gran === 'mois') return `${MOIS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    if (gran === 'trimestre') return `T${key.slice(6)} ${key.slice(0, 4)}`;
    if (gran === 'semestre') return `S${key.slice(6)} ${key.slice(0, 4)}`;
    return key;
  }

  // Valeur d'un indicateur sur une période. Donnée absente : null (affichée « indisponible », jamais 0).
  function kpiValue(kpi, values, key, gran) {
    const inP = (values || []).filter((v) => v.kpi === kpi.id && periodKey(v.date, gran) === key);
    const ok = inP.filter((v) => !v.unavailable && typeof v.value === 'number');
    if (!ok.length) return null;
    if (kpi.agg === 'somme') return Math.round(ok.reduce((a, v) => a + v.value, 0) * 100) / 100;
    // « dernier » : la mesure la plus récente de la période.
    ok.sort((a, b) => String(b.date + (b.at || '')).localeCompare(String(a.date + (a.at || ''))));
    return ok[0].value;
  }

  root.LAPeriodes = { GRANS, periodKey, prevKey, lastKeys, label, start, kpiValue };
})(typeof window !== 'undefined' ? window : globalThis);
