import { getDb } from './firebase.service.js';

const COLLECTION = 'bot-entreno_knowledge_base';

/**
 * Obtiene toda la knowledge base activa como string para inyectar al prompt.
 * @returns {Promise<string>}
 */
export async function getKnowledgeBasePrompt() {
  const db = getDb();
  const snapshot = await db
    .collection(COLLECTION)
    .where('active', '==', true)
    .get();

  if (snapshot.empty) return '';

  const sections = snapshot.docs
    .map(doc => doc.data())
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map(d => `### ${d.title}\n${d.content}`);

  return sections.join('\n\n');
}

/**
 * Obtiene el contenido de un item activo de la knowledge base por título exacto.
 * Usado por respuestas de menú guiado que necesitan un dato puntual sin pasar por Claude.
 * @param {string} title
 * @returns {Promise<string|null>}
 */
export async function getKnowledgeItemByTitle(title) {
  const db = getDb();
  const snapshot = await db
    .collection(COLLECTION)
    .where('active', '==', true)
    .where('title', '==', title)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data().content;
}

/**
 * Obtiene todos los items de la knowledge base (para el dashboard).
 * @returns {Promise<Array>}
 */
export async function getAllKnowledgeItems() {
  const db = getDb();
  const snapshot = await db.collection(COLLECTION).get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/**
 * Crea un nuevo item en la knowledge base.
 * @param {object} item - { title, content, category, order, active }
 * @returns {Promise<object>}
 */
export async function createKnowledgeItem(item) {
  const db = getDb();
  const ref = await db.collection(COLLECTION).add({
    ...item,
    active: item.active ?? true,
    order: item.order ?? 99,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { id: ref.id, ...item };
}

/**
 * Actualiza un item de la knowledge base.
 * @param {string} id
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateKnowledgeItem(id, updates) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ ...updates, updatedAt: new Date() });
}

/**
 * Elimina un item de la knowledge base.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteKnowledgeItem(id) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).delete();
}
