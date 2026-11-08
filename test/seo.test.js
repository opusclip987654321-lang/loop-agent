import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyserHtml, analyserRobots, auditerSite, noter, semaineDe, createSeo } from '../server/seo.js';
import { openDb } from '../server/db.js';

const BON = `<!doctype html><html lang="fr"><head><title>Soirées halal à Paris – Nūr Meet</title>
<meta name="description" content="Des soirées rencontre et networking dans des restaurants halal, chaque semaine à Paris et en Île-de-France.">
<meta name="viewport" content="width=device-width"><meta property="og:title" content="x"><meta property="og:image" content="y">
<link rel="canonical" href="https://exemple.fr/"><script type="application/ld+json">{"@type":"Organization"}</script></head>
<body><h1>Nūr Meet</h1><img src="a.png" alt="a"></body></html>`;

function faux(pages) {
  return async (url) => {
    const p = pages[url];
    if (!p) return { status: 404, ok: false, url, text: async () => 'introuvable' };
    return { status: 200, ok: true, url, text: async () => p };
  };
}

test('lecture d’une page et du robots.txt, comme le cerveau', () => {
  const a = analyserHtml(BON);
  assert.equal(a.langue, 'fr');
  assert.equal(a.h1, 1);
  assert.deepEqual(a.donneesStructurees, ['Organization']);
  const r = analyserRobots('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://exemple.fr/sitemap.xml');
  assert.equal(r.toutFerme, false);
  assert.deepEqual(r.iaFermees, ['GPTBot']);
  assert.deepEqual(r.sitemaps, ['https://exemple.fr/sitemap.xml']);
});

test('note sur 100 et actions par poids ; un site parfait a 100', async () => {
  const pages = {
    'https://exemple.fr/': BON,
    'https://exemple.fr/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://exemple.fr/sitemap.xml',
    'https://exemple.fr/sitemap.xml': '<urlset><url><loc>https://exemple.fr/</loc></url><url><loc>https://exemple.fr/a</loc></url></urlset>',
    'https://exemple.fr/a': BON.replace('Soirées halal à Paris', 'Page A, soirées halal'),
    'https://exemple.fr/llms.txt': 'Nūr Meet : soirées',
  };
  const ok = noter(await auditerSite('https://exemple.fr', { fetch: faux(pages) }));
  assert.equal(ok.note, 100);
  assert.deepEqual(ok.actions, []);
  const sans = { ...pages, 'https://exemple.fr/': BON.replace(/<title>.*<\/title>/, '').replace('lang="fr"', '') };
  delete sans['https://exemple.fr/llms.txt'];
  const r = noter(await auditerSite('https://exemple.fr', { fetch: faux(sans) }));
  assert.ok(r.note < 100);
  assert.deepEqual(r.actions.map((a) => a.cle), ['titre', 'langue', 'llms'], 'les plus lourdes d’abord');
});

test('le dimanche après 8 h seulement, une fois par semaine, rangé dans le projet', async () => {
  assert.equal(semaineDe('2026-11-08'), '2026-W45');
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-seo-'));
  const db = openDb(dataDir);
  try {
    db.putDoc('project:nourmeet', JSON.stringify({ tasks: [] }), 0, 'test');
    let t = Date.parse('2026-11-08T06:00:00Z'); // dimanche 7 h à Paris
    const notes = [];
    const s = createSeo({ db, dataDir, now: () => t, notify: async (m) => notes.push(m), fetchImpl: faux({ 'https://exemple.fr/': BON }), sites: [{ projet: 'nourmeet', site: 'https://exemple.fr' }], log: { error() {} } });
    assert.equal(await s.passage(), null);
    t = Date.parse('2026-11-08T08:30:00Z');
    assert.equal((await s.passage()).length, 1);
    assert.equal(await s.passage(), null, 'pas deux fois la même semaine');
    assert.match(notes[0], /🔎 SEO de la semaine\n• exemple\.fr : \d+\/100/);
    const doc = JSON.parse(db.getDoc('project:nourmeet').value);
    assert.equal(doc.seo[0].semaine, '2026-W45');
    assert.ok(doc.seo[0].actions.length > 0);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
