import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createAgentTools } from '../server/agent-tools.js';
import { describeEvent } from '../server/telegram.js';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'loop-agent-depenses-'));
  const db = openDb(dataDir);
  const tools = Object.fromEntries(createAgentTools({ db, dataDir }).map((t) => [t.name, t]));
  const money = () => JSON.parse(db.getDoc('money').value);
  return { tools, money, done: () => (db.close(), rmSync(dataDir, { recursive: true, force: true })) };
}
const base = { projet: 'petites-histoires', nom: 'Google Cloud (voix Gemini)', montant: 4.2, devise: '$', frequence: 'mois', d_ou: 'Console Google Cloud, octobre 2026' };

test('un agent ajoute une dépense, puis la met à jour sans la dupliquer', async () => {
  const s = setup();
  try {
    await s.tools.enregistrer_depense.handler({ ...base, estimation: true, date: '2026-11-01' });
    let m = s.money();
    assert.equal(m.expenses.length, 1);
    const e = m.expenses[0];
    assert.equal(e.project, 'Petites Histoires Vraies');
    assert.equal(e.amount, 4.2);
    assert.equal(e.estimate, true);
    assert.equal(e.addedBy, 'agent');
    assert.match(m.corrections[0].detail, /ajoutée.*estimation.*source/);

    const msg = await s.tools.enregistrer_depense.handler({ ...base, montant: 5.1 });
    m = s.money();
    assert.equal(m.expenses.length, 1, 'même nom, même projet : mise à jour');
    assert.equal(m.expenses[0].amount, 5.1);
    assert.equal(m.expenses[0].estimate, undefined, 'montant relevé : plus une estimation');
    assert.match(msg, /4\.2 \$ \/ mois → 5\.1 \$ \/ mois/);
  } finally {
    s.done();
  }
});

test('refuse un montant nul, un projet inconnu, une date mal écrite, un doublon ponctuel', async () => {
  const s = setup();
  try {
    await assert.rejects(s.tools.enregistrer_depense.handler({ ...base, montant: 0 }), /positif/);
    await assert.rejects(s.tools.enregistrer_depense.handler({ ...base, projet: 'inconnu' }), /Projet inconnu/);
    await assert.rejects(s.tools.enregistrer_depense.handler({ ...base, date: '07/11/2026' }), /AAAA-MM-JJ/);
    const once = { ...base, projet: 'commun', nom: 'Twilio (recharge)', frequence: 'une fois', date: '2026-11-07', montant: 20, devise: '€' };
    await s.tools.enregistrer_depense.handler(once);
    await assert.rejects(s.tools.enregistrer_depense.handler(once), /déjà notée/);
    assert.equal(s.money().expenses[0].project, 'Commun (plusieurs projets)');
  } finally {
    s.done();
  }
});

test('le récap Telegram signale la dépense notée', () => {
  const ev = describeEvent('enregistrer_depense', { ...base, estimation: true });
  assert.match(ev.line, /Dépense notée : Google Cloud \(voix Gemini\) — 4\.2 \$ \/ mois \(estimation\)/);
  assert.equal(ev.needsOk, false);
});
