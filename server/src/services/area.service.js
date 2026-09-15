import { getDb } from './firebase.service.js';
import admin from 'firebase-admin';

const COLLECTION = 'bot-entreno_areas';
const AGENTS_COLLECTION = 'bot-entreno_agents';

const SEED_AREAS = [
  {
    id: 'ventas',
    name: 'Ventas / Leads',
    description: 'Gente interesada en comprar o contratar que todavía no es cliente: pide información de productos, servicios, precios, o quiere coordinar algo antes de decidir.',
    active: true,
    order: 1,
  },
  {
    id: 'soporte',
    name: 'Soporte',
    description: 'Clientes existentes con dudas de uso, problemas o consultas sobre algo ya contratado.',
    active: true,
    order: 2,
  },
];

export async function seedAreasIfNeeded() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).limit(1).get();
  if (!snap.empty) return;
  const batch = db.batch();
  for (const area of SEED_AREAS) {
    batch.set(db.collection(COLLECTION).doc(area.id), { ...area, createdAt: new Date() });
  }
  await batch.commit();
  console.log('[areas] Seed inicial completado');
}

export async function getAllAreas() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('order').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getActiveAreas() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).where('active', '==', true).orderBy('order').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createArea({ name, description, active = true }) {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('order', 'desc').limit(1).get();
  const lastOrder = snap.empty ? 0 : snap.docs[0].data().order ?? 0;
  const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const existing = await db.collection(COLLECTION).doc(id).get();
  if (existing.exists) throw new Error('Ya existe un área con ese nombre');
  const area = { id, name, description, active, order: lastOrder + 1, createdAt: new Date() };
  await db.collection(COLLECTION).doc(id).set(area);
  return area;
}

export async function updateArea(id, { name, description, active }) {
  const db = getDb();
  const update = { updatedAt: new Date() };
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (active !== undefined) update.active = active;
  await db.collection(COLLECTION).doc(id).update(update);
  const doc = await db.collection(COLLECTION).doc(id).get();
  return { id: doc.id, ...doc.data() };
}

export async function deleteArea(id) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).delete();

  // Clean up: strip this area id from every agent's areaIds array.
  const agentsSnap = await db.collection(AGENTS_COLLECTION).where('areaIds', 'array-contains', id).get();
  if (!agentsSnap.empty) {
    const batch = db.batch();
    for (const doc of agentsSnap.docs) {
      batch.update(doc.ref, { areaIds: admin.firestore.FieldValue.arrayRemove(id) });
    }
    await batch.commit();
  }
}
