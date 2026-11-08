import { createServer } from 'node:http';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createNotifier } from './telegram.js';
import { scheduleBackups } from './backup.js';
import { PROJECTS } from './projects.js';
import { createRoutineRelay, loadRoutines } from './routines.js';
import { createSurveillance } from './surveillance.js';
import { createArgentRappels } from './argent-rappels.js';
import { createBoites } from './boites.js';
import { createSeo } from './seo.js';

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dataDir: process.env.DATA_DIR || './data',
  passwordHash: process.env.LOOP_AGENT_PASSWORD_HASH,
  cookieSecure: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
};

if (!config.passwordHash) {
  console.error('LOOP_AGENT_PASSWORD_HASH manquant. Lance « npm run hash-password » et colle la ligne dans .env.');
  process.exit(1);
}

const db = openDb(config.dataDir);

const notifier = createNotifier({
  db,
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  siteUrl: process.env.SITE_URL || '',
  quietMs: Number(process.env.TELEGRAM_QUIET_MINUTES || 3) * 60 * 1000,
  labelFor: (agent) => {
    const id = agent.replace(/^agent:/, '');
    if (id === 'factures') return 'Factures';
    return PROJECTS.find((p) => p.id === id)?.name || id;
  },
});
const stopTelegram = notifier.start();
console.log(notifier.enabled ? 'Récap Telegram : actif.' : 'Récap Telegram : inactif (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID absents).');

const labelFor = (agent) => {
  const id = agent.replace(/^(agent|project):/, '');
  if (id === 'factures') return 'Factures';
  return PROJECTS.find((p) => p.id === id)?.name || id;
};
const relay = createRoutineRelay({
  dataDir: config.dataDir,
  cooldownMs: Number(process.env.ROUTINE_COOLDOWN_MINUTES || 30) * 60 * 1000,
  labelFor,
  notify: (text) => (notifier.enabled ? notifier.send(text) : Promise.resolve()),
});
const stopRelay = relay.start();
{
  const n = Object.keys(loadRoutines(config.dataDir)).length;
  console.log(n ? `Relance des agents : ${n} projet(s) branché(s).` : 'Relance des agents : aucun projet branché (npm run routine-jeton).');
}

// Surveillance des sites (reprise du cerveau central). SURVEILLANCE=0 pour la couper.
const stopSurveillance =
  process.env.SURVEILLANCE === '0'
    ? () => {}
    : createSurveillance({ dataDir: config.dataDir, notify: (text) => (notifier.enabled ? notifier.send(text) : Promise.resolve()) }).start();
console.log(process.env.SURVEILLANCE === '0' ? 'Surveillance des sites : coupée.' : 'Surveillance des sites : active (toutes les 5 min).');

// Rappels Argent : renouvellements à 3 jours et bilan du 1er du mois (reprise du cerveau central).
const stopArgent = notifier.enabled ? createArgentRappels({ db, dataDir: config.dataDir, notify: (t) => notifier.send(t) }).start() : () => {};

// Mails urgents des 6 boîtes Gmail, chaque heure (reprise du cerveau central). Sans adresse rangée, ne fait rien.
const stopBoites = notifier.enabled ? createBoites({ dataDir: config.dataDir, notify: (t) => notifier.send(t) }).start() : () => {};

// Compte rendu SEO du dimanche 8 h (reprise du cerveau central, sans IA).
const stopSeo = createSeo({ db, dataDir: config.dataDir, notify: (t) => (notifier.enabled ? notifier.send(t) : Promise.resolve()) }).start();

const stopBackups = scheduleBackups({
  db,
  dataDir: config.dataDir,
  keep: Number(process.env.BACKUP_KEEP || 14),
  hour: Number(process.env.BACKUP_HOUR || 3),
});

const server = createServer(
  createApp({ db, ...config, onToolDone: (agent, tool, args) => notifier.note(agent, tool, args), onWalidSave: relay.onWalidSave })
);
server.requestTimeout = 60_000;
server.listen(config.port, config.host, () => {
  console.log(`Loop Agent écoute sur http://${config.host}:${config.port}`);
});

function shutdown() {
  stopTelegram();
  stopRelay();
  stopSurveillance();
  stopArgent();
  stopBoites();
  stopSeo();
  stopBackups();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
