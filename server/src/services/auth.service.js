import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { getDb } from './firebase.service.js';

const COLLECTION = 'bot-entreno_agents';

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

function docId(email) {
  return email.toLowerCase().trim();
}

function toPublic(data) {
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: data.role ?? 'operador',
    areaIds: data.areaIds ?? [],
  };
}

const ADMIN_SEEDS = [
  { email: process.env.ADMIN_EMAIL || 'admin@empresa.com', name: process.env.ADMIN_NAME || 'Admin', password: process.env.ADMIN_PASSWORD },
];

export async function seedAgentsIfNeeded() {
  const db = getDb();
  for (const admin of ADMIN_SEEDS) {
    const id = docId(admin.email);
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
      await db.collection(COLLECTION).doc(id).set({
        id,
        email: admin.email,
        name: admin.name,
        role: 'admin',
        passwordHash: hashPassword(admin.password),
        createdAt: new Date(),
      });
      console.log('[auth] Admin seedeado:', admin.email);
    } else {
      const data = doc.data();
      const updates = {};
      if (data.role !== 'admin') updates.role = 'admin';
      if (Object.keys(updates).length > 0) {
        await db.collection(COLLECTION).doc(id).update(updates);
        console.log('[auth] Admin actualizado:', admin.email, updates);
      }
    }
  }
}

const ADMIN_EMAILS = new Set(ADMIN_SEEDS.map(a => a.email));

export async function validateCredentials(email, password) {
  const db = getDb();
  const id = docId(email);
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.passwordHash !== hashPassword(password)) return null;
  // guarantee admin role for seeded admins regardless of Firestore state
  if (ADMIN_EMAILS.has(id) && data.role !== 'admin') {
    await db.collection(COLLECTION).doc(id).update({ role: 'admin' });
    data.role = 'admin';
  }
  return toPublic(data);
}

export async function createUser({ email, name, password, role = 'operador', areaIds = [] }) {
  const db = getDb();
  const id = docId(email);
  const existing = await db.collection(COLLECTION).doc(id).get();
  if (existing.exists) throw new Error('El email ya está registrado');
  const user = { id, email: email.toLowerCase().trim(), name, role, areaIds, passwordHash: hashPassword(password), createdAt: new Date() };
  await db.collection(COLLECTION).doc(id).set(user);
  return toPublic(user);
}

export async function listUsers() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('createdAt').get();
  return snap.docs.map(d => toPublic(d.data()));
}

export async function deleteUser(id) {
  const db = getDb();
  await db.collection(COLLECTION).doc(docId(id)).delete();
}

export async function updateUser(id, { name, role, areaIds } = {}) {
  const db = getDb();
  const update = { updatedAt: new Date() };
  if (name) update.name = name;
  if (role) update.role = role;
  if (areaIds !== undefined) update.areaIds = areaIds;
  await db.collection(COLLECTION).doc(docId(id)).update(update);
  const doc = await db.collection(COLLECTION).doc(docId(id)).get();
  return toPublic(doc.data());
}

export async function getAgentById(id) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(docId(id)).get();
  if (!doc.exists) return null;
  return toPublic(doc.data());
}

export async function updateProfile(agentId, { name, password } = {}) {
  const db = getDb();
  const update = { updatedAt: new Date() };
  if (name) update.name = name;
  if (password) update.passwordHash = hashPassword(password);
  await db.collection(COLLECTION).doc(agentId).update(update);
  const doc = await db.collection(COLLECTION).doc(agentId).get();
  return toPublic(doc.data());
}

export function generateToken(agent) {
  return jwt.sign(
    { id: agent.id, email: agent.email, name: agent.name, role: agent.role, areaIds: agent.areaIds ?? [] },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
