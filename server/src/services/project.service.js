import { getDb } from './firebase.service.js';

const COLLECTION = 'bot-entreno_projects';

// contactPhones es un array plano de strings, separado de `contactos` (array
// de objetos), porque Firestore no permite hacer `array-contains` sobre un
// campo DENTRO de objetos anidados en un array — solo sobre valores
// primitivos. Se recalcula server-side en cada write, nunca se confía en que
// el cliente lo mande sincronizado con `contactos`.
function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

function buildContactPhones(contactos = []) {
  return [...new Set(contactos.map(c => normalizePhone(c.telefono)).filter(Boolean))];
}

export async function getAllProjects() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('nombre').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getProjectById(id) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createProject({ nombre, empresa, descripcion = '', estado = 'activo', contactos = [] }) {
  const db = getDb();
  const project = {
    nombre,
    empresa,
    descripcion,
    estado,
    contactos,
    contactPhones: buildContactPhones(contactos),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const ref = await db.collection(COLLECTION).add(project);
  return { id: ref.id, ...project };
}

export async function updateProject(id, { nombre, empresa, descripcion, estado, contactos } = {}) {
  const db = getDb();
  const update = { updatedAt: new Date() };
  if (nombre !== undefined) update.nombre = nombre;
  if (empresa !== undefined) update.empresa = empresa;
  if (descripcion !== undefined) update.descripcion = descripcion;
  if (estado !== undefined) update.estado = estado;
  if (contactos !== undefined) {
    update.contactos = contactos;
    update.contactPhones = buildContactPhones(contactos);
  }
  await db.collection(COLLECTION).doc(id).update(update);
  const doc = await db.collection(COLLECTION).doc(id).get();
  return { id: doc.id, ...doc.data() };
}

export async function deleteProject(id) {
  await getDb().collection(COLLECTION).doc(id).delete();
}

// Usado por bot.service.js para vincular un ticket al proyecto correcto según
// el número de WhatsApp que escribe. Sin `.orderBy()` a propósito — una
// equality-only query con `array-contains` no necesita un índice compuesto
// (mismo criterio ya aplicado en otros bots de este workspace para no
// depender de índices que no existen todavía en un proyecto Firestore
// recién creado/migrado).
export async function findProjectByPhone(phone) {
  const db = getDb();
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const snap = await db.collection(COLLECTION).where('contactPhones', 'array-contains', normalized).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
