import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: FIREBASE_CLIENT_EMAIL,
  }),
});

const db = admin.firestore();
const contactId = process.argv[2];

const doc = await db.collection('bot-entreno_conversations').doc(contactId).get();
if (!doc.exists) {
  console.log('No existe');
  process.exit(0);
}
const data = doc.data();
for (const m of data.messages || []) {
  const ts = m.timestamp?.toDate?.() ?? m.timestamp;
  console.log(`[${ts}] (${m.role || m.sender}) ${m.content || m.text || JSON.stringify(m)}`);
}
process.exit(0);
