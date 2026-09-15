import { getDb } from './firebase.service.js';

const COLLECTION = 'bot-entreno_labels';

export async function getAllLabels() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).get();
  const labels = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  labels.sort((a, b) => a.name.localeCompare(b.name));
  return labels;
}

export async function createLabel(name, color) {
  const db = getDb();
  const existing = await db.collection(COLLECTION).where('name', '==', name).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  const ref = await db.collection(COLLECTION).add({ name, color, createdAt: new Date() });
  return { id: ref.id, name, color };
}

export async function deleteLabel(id) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).delete();
}
