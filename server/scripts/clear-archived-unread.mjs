// Pone en 0 el contador de no leídos de las conversaciones archivadas
// (resolved / bot_archived). Antes de este fix, archivar no tocaba `unread`
// y quedaba el globito "(5)" en charlas que ya había resuelto el bot.
//
// Uso:
//   node scripts/clear-archived-unread.mjs           # dry-run
//   node scripts/clear-archived-unread.mjs --apply   # aplica

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const COLLECTION = 'bot-entreno_conversations';

const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: FIREBASE_CLIENT_EMAIL,
  }),
});
const db = admin.firestore();

const all = await db.collection(COLLECTION)
  .where('status', 'in', ['resolved', 'bot_archived'])
  .select('unread')
  .get();
const docs = all.docs.filter(d => (d.data().unread ?? 0) > 0);

console.log(`${docs.length} de ${all.size} archivadas con no leídos (total ${docs.reduce((s, d) => s + d.data().unread, 0)} msgs)`);

if (APPLY && docs.length) {
  let batch = db.batch();
  let n = 0;
  for (const doc of docs) {
    batch.update(doc.ref, { unread: 0 });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`Listo: ${n} actualizadas.`);
} else if (!APPLY) {
  console.log('Dry-run. Correr con --apply para aplicar.');
}
process.exit(0);
