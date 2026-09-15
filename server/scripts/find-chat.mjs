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
const search = process.argv[2];

const snap = await db.collection('bot-entreno_conversations').get();
const matches = [];
snap.forEach((doc) => {
  if (doc.id.includes(search)) matches.push(doc);
});

console.log(`Total conversaciones: ${snap.size}. Coincidencias para "${search}": ${matches.length}`);
for (const doc of matches) {
  const data = doc.data();
  console.log('---');
  console.log('contactId:', doc.id);
  console.log('contactName:', data.contactName);
  console.log('channel:', data.channel);
  console.log('status:', data.status, '| humanMode:', data.humanMode, '| assignedTo:', data.assignedTo);
  console.log('mensajes:', (data.messages || []).length);
  console.log('createdAt:', data.createdAt?.toDate?.() ?? data.createdAt);
  console.log('updatedAt:', data.updatedAt?.toDate?.() ?? data.updatedAt);
}

process.exit(0);
