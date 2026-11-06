// Réglage du récap Telegram, sur le serveur :
//   node scripts/telegram.js trouver   -> affiche l'identifiant de ta conversation avec le bot
//                                          (envoie d'abord un message au bot dans Telegram)
//   node scripts/telegram.js tester    -> envoie un message d'essai
// Le jeton est lu dans TELEGRAM_BOT_TOKEN (fichier .env), jamais affiché.
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const cmd = process.argv[2];

if (!token) {
  console.log('TELEGRAM_BOT_TOKEN est vide dans .env.');
  process.exit(1);
}
const api = (m, body) =>
  fetch(`https://api.telegram.org/bot${token}/${m}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json());

if (cmd === 'trouver') {
  const r = await api('getUpdates');
  if (!r.ok) {
    console.log('Telegram refuse le jeton : vérifie TELEGRAM_BOT_TOKEN.');
    process.exit(1);
  }
  const chats = new Map();
  for (const u of r.result || []) {
    const c = (u.message || u.edited_message || u.my_chat_member || {}).chat;
    if (c) chats.set(c.id, c.first_name || c.title || c.username || '');
  }
  if (!chats.size) console.log('Aucun message reçu. Ouvre ton bot dans Telegram, envoie « bonjour », puis relance.');
  for (const [id, name] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
} else if (cmd === 'tester') {
  if (!chatId) {
    console.log('TELEGRAM_CHAT_ID est vide dans .env.');
    process.exit(1);
  }
  const r = await api('sendMessage', { chat_id: chatId, text: '✅ Loop Agent : le récap Telegram fonctionne.' });
  console.log(r.ok ? 'Message envoyé.' : 'Échec : ' + (r.description || 'inconnu'));
  process.exitCode = r.ok ? 0 : 1;
} else {
  console.log('Usage : trouver | tester');
  process.exitCode = 1;
}
