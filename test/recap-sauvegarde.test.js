import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';
import { createNotifier, buildMessage } from '../server/telegram.js';
import { runBackup } from '../server/backup.js';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-recap-'));
  const db = openDb(dataDir);
  const sent = [];
  let fail = false;
  const fetchImpl = async (url, opts) => {
    if (fail) return { ok: false, status: 502 };
    sent.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200 };
  };
  const notifier = createNotifier({
    db, token: 'T', chatId: '42', siteUrl: 'https://exemple.test', quietMs: 60_000, fetchImpl,
    labelFor: (a) => a.replace('agent:', ''), log: { error() {} },
  });
  const tools = Object.fromEntries(
    createAgentTools({ db, dataDir, onToolDone: (a, t, args) => notifier.note(a, t, args) }).map((t) => [t.name, t])
  );
  return {
    db, dataDir, sent, notifier, tools,
    setFail: (v) => (fail = v),
    done: () => { db.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

const BRIEF = { observe: 'o', deduction: 'd', proposition: 'p', effet: 'e', si_rien: 's' };

test('récap : un seul message par agent, envoyé après le silence, puis vidé', async () => {
  const s = setup();
  try {
    const action = (await s.tools.lire_projet.handler({ projet: 'cambodge' })).actions[0].id;
    await s.tools.ecrire_tour.handler({ projet: 'cambodge', action, constat: '15 offres lues', decision: 'continuer' });
    await s.tools.proposer_action.handler({
      projet: 'cambodge', titre: 'Filtrer le télétravail', objectif: 'x', type: 'Boucle', critere: 'y', brief: BRIEF,
    });
    await s.tools.lister_projets.handler({}); // lecture : pas de ligne

    // Tour pas fini : rien ne part.
    assert.equal(await s.notifier.flush(Date.now()), 0);
    assert.equal(s.sent.length, 0);

    // Après le silence : un message, deux lignes, un point à valider.
    assert.equal(await s.notifier.flush(Date.now() + 61_000), 1);
    const text = s.sent[0].body.text;
    assert.equal(s.sent[0].body.chat_id, '42');
    assert.match(text, /^🔁 cambodge — tour terminé/);
    assert.match(text, /1 point\(s\) attendent ta validation/);
    assert.match(text, /15 offres lues/);
    assert.match(text, /Nouvelle action à valider : Filtrer le télétravail/);
    assert.match(text, /https:\/\/exemple\.test$/);

    // Vidé : rien de plus au passage suivant.
    assert.equal(await s.notifier.flush(Date.now() + 120_000), 0);
  } finally {
    s.done();
  }
});

test('récap : Telegram en panne → on garde les lignes et on réessaie', async () => {
  const s = setup();
  try {
    const p = await s.tools.lire_projet.handler({ projet: 'cambodge' });
    await s.tools.ecrire_tour.handler({ projet: 'cambodge', action: p.actions[0].id, constat: 'c', decision: 'd' });
    s.setFail(true);
    assert.equal(await s.notifier.flush(Date.now() + 61_000), 0);
    s.setFail(false);
    assert.equal(await s.notifier.flush(Date.now() + 61_000), 1);
  } finally {
    s.done();
  }
});

test('récap : sans jeton, rien n’est noté', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-recap-'));
  const db = openDb(dataDir);
  try {
    const n = createNotifier({ db, token: '', chatId: '' });
    n.note('agent:x', 'ecrire_tour', { action: 'a', constat: 'c' });
    assert.equal(n.enabled, false);
    assert.equal(db.quietNoticeAgents('9999').length, 0);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('récap : message trop long coupé sous la limite Telegram', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ line: `▸ ligne ${i} ` + 'x'.repeat(100), needs_ok: 0 }));
  const m = buildMessage('A', rows, '');
  assert.ok(m.length < 4096);
  assert.match(m, /autre\(s\) ligne\(s\) dans Loop Agent/);
});

test('sauvegarde : base lisible, factures copiées, 14 gardées', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-bak-'));
  const db = openDb(dataDir);
  try {
    db.putDoc('money', '{"a":1}', 0, 'test');
    mkdirSync(join(dataDir, 'files'), { recursive: true });
    writeFileSync(join(dataDir, 'files', 'f1'), 'pdf');
    for (let d = 1; d <= 16; d++) runBackup({ db, dataDir, keep: 14, now: new Date(2026, 10, d, 3) });
    const names = readdirSync(join(dataDir, 'backups')).filter((f) => f.endsWith('.sqlite')).sort();
    assert.equal(names.length, 14);
    assert.equal(names[0], 'loop-agent-2026-11-03.sqlite');
    assert.ok(existsSync(join(dataDir, 'backups', 'files', 'f1')));
    const copy = new DatabaseSync(join(dataDir, 'backups', names[13]), { readOnly: true });
    assert.equal(copy.prepare("SELECT value FROM docs WHERE key='money'").get().value, '{"a":1}');
    copy.close();
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('action refusée : ne tourne pas, raison lue par l’agent, « remplace » la retire', async () => {
  const s = setup();
  try {
    const r = await s.tools.proposer_action.handler({
      projet: 'leviaro', titre: 'MP massifs', objectif: 'x', type: 'Boucle', critere: 'y', brief: BRIEF,
    });
    // Walid refuse avec une raison (écrit par l'interface)
    const cur = s.db.getDoc('project:leviaro');
    const doc = JSON.parse(cur.value);
    const t = doc.tasks.find((x) => x.id === r.action);
    Object.assign(t, { proposalStatus: 'rejected', rejectReason: 'trop risqué', decidedAt: new Date().toISOString() });
    s.db.putDoc('project:leviaro', JSON.stringify(doc), cur.version, 'walid');

    const lu = (await s.tools.lire_projet.handler({ projet: 'leviaro' })).actions.find((a) => a.id === r.action);
    assert.equal(lu.proposition.statut, 'rejected');
    assert.equal(lu.proposition.raison_du_refus, 'trop risqué');
    await assert.rejects(
      () => s.tools.ecrire_tour.handler({ projet: 'leviaro', action: r.action, constat: 'c', decision: 'd' }),
      /refusé/
    );
    const r2 = await s.tools.proposer_action.handler({
      projet: 'leviaro', titre: 'MP sur 10 contacts', objectif: 'x', type: 'Ponctuelle', critere: 'y', brief: BRIEF, remplace: r.action,
    });
    const lu2 = (await s.tools.lire_projet.handler({ projet: 'leviaro' })).actions.find((a) => a.id === r.action);
    assert.equal(lu2.proposition.remplacee_par, r2.action);
  } finally {
    s.done();
  }
});
