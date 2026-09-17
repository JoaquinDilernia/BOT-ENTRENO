import { getDb } from './firebase.service.js';
import { findCustomerByPhone, getCustomerOrders } from './tiendanube.service.js';

const COLLECTION = 'bot-entreno_customers';
const TN_CACHE_HOURS = 6;

export async function getOrCreateCustomer(contactId, channel, contactName = null) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();

  if (doc.exists) {
    const updates = { lastContactAt: new Date() };
    if (contactName && !doc.data().contactName) updates.contactName = contactName;
    await docRef.update(updates);
    return { id: doc.id, ...doc.data(), ...updates };
  }

  const customer = {
    contactId,
    channel,
    contactName: contactName ?? null,
    email: null,
    firstContactAt: new Date(),
    lastContactAt: new Date(),
    agentNotes: '',
    tags: [],
    tnCustomerId: null,
    tnEmail: null,
    tnOrders: [],
    tnOrdersUpdatedAt: null,
    source: 'bot',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await docRef.set(customer);
  return { id: contactId, ...customer };
}

/**
 * Trae y cachea el historial de compras en TiendaNube de un contacto,
 * buscando por su teléfono de WhatsApp. Igual patrón que BOT-ALTORANCHO
 * (ver [[project-bots]]) — cache de TN_CACHE_HOURS para no pegarle a la API
 * de TiendaNube en cada mensaje.
 */
export async function enrichCustomerFromTiendaNube(contactId, forceRefresh = false) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();
  if (!doc.exists) return;

  const data = doc.data();

  if (!forceRefresh && data.tnOrdersUpdatedAt) {
    const updatedAt = data.tnOrdersUpdatedAt._seconds
      ? new Date(data.tnOrdersUpdatedAt._seconds * 1000)
      : new Date(data.tnOrdersUpdatedAt);
    const hoursSince = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < TN_CACHE_HOURS) return;
  }

  const phone = contactId.replace(/\D/g, '');
  const tnCustomer = await findCustomerByPhone(phone);

  if (!tnCustomer) {
    await docRef.update({ tnOrdersUpdatedAt: new Date() });
    return;
  }

  const rawOrders = await getCustomerOrders(tnCustomer.id);
  const tnOrders = mapTnOrders(rawOrders);

  await docRef.update({
    tnCustomerId: tnCustomer.id,
    tnEmail: tnCustomer.email ?? null,
    contactName: data.contactName ?? tnCustomer.name ?? null,
    tnOrders,
    tnOrdersUpdatedAt: new Date(),
  });
}

/** Vincula un contacto a su cliente de TiendaNube apenas se encuentra un
 * pedido suyo en la conversación (evita esperar al próximo ciclo de cache). */
export async function linkCustomerFromOrder(contactId, tnCustomer) {
  if (!tnCustomer?.id) return;
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();
  if (!doc.exists) return;
  const data = doc.data();
  if (data.tnCustomerId) return;

  const rawOrders = await getCustomerOrders(tnCustomer.id);
  const tnOrders = mapTnOrders(rawOrders);

  await docRef.update({
    tnCustomerId: tnCustomer.id,
    tnEmail: tnCustomer.email ?? null,
    contactName: data.contactName ?? tnCustomer.name ?? null,
    tnOrders,
    tnOrdersUpdatedAt: new Date(),
  });
  console.log(`[customer] Auto-linked ${contactId} → TN customer #${tnCustomer.id}`);
}

function mapTnOrders(rawOrders) {
  return (rawOrders ?? []).slice(0, 10).map(o => ({
    number: o.number,
    date: o.created_at?.split('T')[0] ?? null,
    status: o.status,
    paymentStatus: o.payment_status,
    shippingStatus: o.shipping_status,
    total: o.total,
    products: (o.products ?? []).map(p => {
      const name = typeof p.name === 'string' ? p.name
        : (p.name?.es ?? p.name?.en ?? Object.values(p.name ?? {})[0] ?? 'Producto');
      const variants = (p.variant_values ?? []).join(' / ');
      return variants ? `${name} (${variants})` : name;
    }),
  }));
}

export async function getCustomerProfile(contactId) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(contactId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function updateCustomerNotes(contactId, agentNotes) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({
    agentNotes: agentNotes ?? '',
    updatedAt: new Date(),
  });
}

export function buildCustomerContext(customer) {
  if (!customer) return null;

  const lines = [];
  if (customer.contactName) lines.push(`Nombre: ${customer.contactName}`);
  if (customer.tnEmail) lines.push(`Email: ${customer.tnEmail}`);
  lines.push(`Canal: ${customer.channel}`);
  if (customer.firstContactAt) lines.push(`Primera consulta: ${formatDate(customer.firstContactAt)}`);

  if (customer.tnOrders?.length) {
    lines.push(`\nHistorial de compras en Tienda Nube (${customer.tnOrders.length} pedido/s):`);
    for (const o of customer.tnOrders) {
      const parts = [`#${o.number}`, o.date ?? '?', `$${o.total}`];
      if (o.status) parts.push(`estado: ${o.status}`);
      if (o.paymentStatus) parts.push(`pago: ${o.paymentStatus}`);
      if (o.shippingStatus) parts.push(`envío: ${o.shippingStatus}`);
      if (o.products?.length) parts.push(`productos: ${o.products.join(', ')}`);
      lines.push(`  - ${parts.join(' | ')}`);
    }
  }

  if (customer.agentNotes) {
    lines.push(`\nNotas del equipo: ${customer.agentNotes}`);
  }

  return lines.join('\n');
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
    return d.toLocaleDateString('es-AR');
  } catch { return ''; }
}

// ─────────────────────────── Contactos (listado + CRUD) ───────────────────
// Mismo criterio que `searchConversations` en conversation.service.js: se
// trae la colección entera y se filtra en memoria — no hay tantos contactos
// como para justificar índices compuestos de Firestore, y así el filtro de
// texto + tags + canal se resuelve con una sola función sin duplicar lógica
// entre server y client.

// Saca acentos para comparar sin distinguir mayúsculas/tildes (mismo criterio
// que Sedes.jsx / doctors.service.js en los otros bots): tras NFD, las tildes
// quedan como marcas combinantes fuera del rango ASCII básico.
function norm(s) {
  return (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[^\x20-\x7e]/g, '');
}

function mapCustomerDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    contactId: data.contactId ?? doc.id,
    channel: data.channel ?? null,
    contactName: data.contactName ?? null,
    email: data.email ?? data.tnEmail ?? null,
    tags: data.tags ?? [],
    agentNotes: data.agentNotes ?? '',
    source: data.source ?? 'bot',
    firstContactAt: data.firstContactAt ?? null,
    lastContactAt: data.lastContactAt ?? null,
    createdAt: data.createdAt ?? data.firstContactAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

/**
 * @param {object} filters
 * @param {string} [filters.q]        busca en nombre y contactId/teléfono
 * @param {string[]} [filters.tags]   contacto debe tener AL MENOS UNA de estas tags
 * @param {string} [filters.channel]  'whatsapp' | 'instagram'
 */
export async function listCustomers(filters = {}) {
  const db = getDb();
  const snap = await db.collection(COLLECTION).get();
  let docs = snap.docs.map(mapCustomerDoc);

  if (filters.channel) docs = docs.filter(c => c.channel === filters.channel);
  if (filters.tags?.length) {
    docs = docs.filter(c => filters.tags.some(t => c.tags.includes(t)));
  }
  const q = norm(filters.q).trim();
  if (q) {
    docs = docs.filter(c => norm(c.contactName).includes(q) || norm(c.contactId).includes(q) || norm(c.email).includes(q));
  }

  docs.sort((a, b) => tsToMs(b.lastContactAt ?? b.createdAt) - tsToMs(a.lastContactAt ?? a.createdAt));
  return docs;
}

export async function listAllTags() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).get();
  const set = new Set();
  snap.docs.forEach(doc => (doc.data().tags ?? []).forEach(t => set.add(t)));
  return [...set].sort((a, b) => norm(a).localeCompare(norm(b)));
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  const d = new Date(ts);
  return isNaN(d) ? 0 : d.getTime();
}

/** Alta manual desde el panel — `contactId` ya viene normalizado (mismo
    formato que usa `/api/conversations/start` para WhatsApp). */
export async function createCustomer({ contactId, channel, contactName, email, tags }) {
  if (!contactId || !channel) {
    const e = new Error('contactId y channel son requeridos');
    e.status = 400;
    throw e;
  }
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const existing = await docRef.get();
  if (existing.exists) {
    const e = new Error('Ya existe un contacto con ese identificador/teléfono');
    e.status = 409;
    throw e;
  }
  const customer = {
    contactId,
    channel,
    contactName: contactName?.trim() || null,
    email: email?.trim() || null,
    firstContactAt: null, // sin conversación todavía
    lastContactAt: null,
    agentNotes: '',
    tags: Array.isArray(tags) ? tags : [],
    source: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await docRef.set(customer);
  return { id: contactId, ...customer };
}

export async function updateCustomer(contactId, patch) {
  const db = getDb();
  const update = { updatedAt: new Date() };
  if (patch.contactName !== undefined) update.contactName = patch.contactName?.trim() || null;
  if (patch.email !== undefined) update.email = patch.email?.trim() || null;
  if (patch.tags !== undefined) update.tags = Array.isArray(patch.tags) ? patch.tags : [];
  if (patch.agentNotes !== undefined) update.agentNotes = patch.agentNotes ?? '';
  await db.collection(COLLECTION).doc(contactId).update(update);
  return getCustomerProfile(contactId);
}

export async function deleteCustomer(contactId) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).delete();
}

// ─────────────────────────── Import / export CSV ──────────────────────────
// Parser/serializer CSV mínimo (RFC4180: comillas dobles, comas y saltos de
// línea dentro de un campo entre comillas) — no se suma una dependencia
// nueva sólo para esto, el formato de contacto es simple y plano.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Importa filas ya parseadas con header. Columnas esperadas (case-insensitive):
 * telefono/phone/contactid (requerida), nombre/name, canal/channel (default whatsapp),
 * email, tags (separadas por ; o ,).
 * Upsert por contactId: si ya existe, hace merge de nombre/email (sólo si vacíos)
 * y UNIÓN de tags — así reimportar el mismo CSV no pisa tags cargadas a mano.
 */
export async function importCustomersCsv(rows, { normalizePhone } = {}) {
  if (rows.length === 0) return { created: 0, updated: 0, skipped: 0, errors: [] };
  const header = rows[0].map(h => norm(h).trim());
  const idx = (names) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1;
  const iPhone = idx(['telefono', 'phone', 'contactid', 'celular', 'whatsapp']);
  const iName = idx(['nombre', 'name', 'contactname']);
  const iChannel = idx(['canal', 'channel']);
  const iEmail = idx(['email', 'mail', 'correo']);
  const iTags = idx(['tags', 'etiquetas']);

  if (iPhone === -1) {
    const e = new Error('El CSV necesita una columna "telefono" (o "phone"/"contactId") con el identificador del contacto.');
    e.status = 400;
    throw e;
  }

  const db = getDb();
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const rawId = (cols[iPhone] ?? '').trim();
    if (!rawId) { skipped++; continue; }
    const channel = (iChannel >= 0 ? cols[iChannel]?.trim() : '') || 'whatsapp';
    const contactId = channel === 'whatsapp' && normalizePhone ? normalizePhone(rawId) : rawId;
    if (!contactId) { skipped++; continue; }
    const name = iName >= 0 ? cols[iName]?.trim() || null : null;
    const email = iEmail >= 0 ? cols[iEmail]?.trim() || null : null;
    const tags = iTags >= 0
      ? (cols[iTags] ?? '').split(/[;,]/).map(t => t.trim()).filter(Boolean)
      : [];

    try {
      const docRef = db.collection(COLLECTION).doc(contactId);
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data();
        const mergedTags = [...new Set([...(data.tags ?? []), ...tags])];
        await docRef.update({
          ...(name && !data.contactName ? { contactName: name } : {}),
          ...(email && !data.email ? { email } : {}),
          tags: mergedTags,
          updatedAt: new Date(),
        });
        updated++;
      } else {
        await docRef.set({
          contactId, channel, contactName: name, email,
          firstContactAt: null, lastContactAt: null, agentNotes: '',
          tags, source: 'import', createdAt: new Date(), updatedAt: new Date(),
        });
        created++;
      }
    } catch (err) {
      errors.push({ row: r + 1, contactId: rawId, error: err.message });
    }
  }

  return { created, updated, skipped, errors };
}

export async function exportCustomersCsv() {
  const customers = await listCustomers();
  const header = ['contactId', 'canal', 'nombre', 'email', 'tags', 'primeraConsulta', 'ultimaConsulta'];
  const lines = [header.map(csvCell).join(',')];
  for (const c of customers) {
    lines.push([
      c.contactId, c.channel ?? '', c.contactName ?? '', c.email ?? '',
      (c.tags ?? []).join(';'),
      c.firstContactAt ? formatDate(c.firstContactAt) : '',
      c.lastContactAt ? formatDate(c.lastContactAt) : '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
