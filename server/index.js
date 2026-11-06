import { createServer } from 'node:http';
import { openDb } from './db.js';
import { createApp } from './app.js';

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
const server = createServer(createApp({ db, ...config }));
server.requestTimeout = 60_000;
server.listen(config.port, config.host, () => {
  console.log(`Loop Agent écoute sur http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
