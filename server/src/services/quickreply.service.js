import { getDb } from './firebase.service.js';

const COLLECTION = 'bot-entreno_quick_replies';

export async function getAllQuickReplies() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('shortcut').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createQuickReply(shortcut, title, text) {
  const db = getDb();
  const ref = await db.collection(COLLECTION).add({
    shortcut: shortcut.trim().toLowerCase(),
    title: title.trim(),
    text: text.trim(),
    createdAt: new Date(),
  });
  return { id: ref.id, shortcut: shortcut.trim().toLowerCase(), title: title.trim(), text: text.trim() };
}

export async function deleteQuickReply(id) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).delete();
}
