import { getDb } from './firebase.service.js';
import { listUsers } from './auth.service.js';
import { getAllTemplates } from './template.service.js';
import { sendWhatsAppTemplate } from './meta.service.js';

const COLLECTION = 'bot-entreno_tickets';
const RESOLVED_TEMPLATE_NAME = 'ticket_resuelto';

// Filtra en memoria en vez de con `.where()` encadenados: el volumen esperado
// de tickets es bajo (herramienta interna de soporte, no un
// sistema de alto tráfico) y así se evita necesitar un índice compuesto para
// cada combinación de estado+prioridad+orderBy.
export async function getAllTickets({ estado, prioridad } = {}) {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('createdAt', 'desc').get();
  let tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (estado) tickets = tickets.filter(t => t.estado === estado);
  if (prioridad) tickets = tickets.filter(t => t.prioridad === prioridad);
  return tickets;
}

export async function getTicketById(id) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// Ticket sin asignación explícita cae en el primer agente admin — resuelto
// dinámicamente (nunca un email hardcodeado) para no romper si cambia quién
// es el admin.
export async function getDefaultAssignee() {
  const users = await listUsers();
  const admin = users.find(u => u.role === 'admin');
  return admin?.email ?? null;
}

export async function createTicket({ titulo, descripcion, proyectoId = null, contactId = null, prioridad = 'media', imagenes = [], createdBy }) {
  const db = getDb();
  const assignedTo = await getDefaultAssignee();
  const ticket = {
    titulo,
    descripcion,
    proyectoId,
    contactId,
    conversationId: contactId,
    prioridad,
    estado: 'abierto',
    imagenes,
    createdBy,
    assignedTo,
    comentarios: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
  };
  const ref = await db.collection(COLLECTION).add(ticket);
  return { id: ref.id, ...ticket };
}

export async function updateTicket(id, { titulo, descripcion, prioridad, estado, assignedTo, proyectoId, imagenes } = {}) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(id);
  const before = await docRef.get();
  if (!before.exists) throw new Error('Ticket no encontrado');
  const beforeData = before.data();

  const update = { updatedAt: new Date() };
  if (titulo !== undefined) update.titulo = titulo;
  if (descripcion !== undefined) update.descripcion = descripcion;
  if (prioridad !== undefined) update.prioridad = prioridad;
  if (assignedTo !== undefined) update.assignedTo = assignedTo;
  if (proyectoId !== undefined) update.proyectoId = proyectoId;
  if (imagenes !== undefined) update.imagenes = imagenes;

  const justResolved = estado === 'resuelto' && beforeData.estado !== 'resuelto';
  if (estado !== undefined) {
    update.estado = estado;
    if (justResolved) {
      update.resolvedAt = new Date();
      update.notificationStatus = 'pending';
    }
  }

  await docRef.update(update);
  const after = await docRef.get();
  const ticket = { id: after.id, ...after.data() };

  if (justResolved && ticket.contactId) {
    // Fire-and-forget — un fallo notificando no debe bloquear ni revertir el
    // cambio de estado que el agente ya confirmó.
    notifyTicketResolved(ticket).catch(err => console.error('[ticket] Error notificando resolución:', err.message));
  }

  return ticket;
}

export async function addComment(id, { autor, texto }) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new Error('Ticket no encontrado');
  const comentarios = [...(doc.data().comentarios ?? []), { autor, texto, createdAt: new Date() }];
  await docRef.update({ comentarios, updatedAt: new Date() });
  return comentarios;
}

async function notifyTicketResolved(ticket) {
  const db = getDb();
  const templates = await getAllTemplates();
  const approved = templates.find(t => t.name === RESOLVED_TEMPLATE_NAME && t.metaStatus === 'APPROVED');
  if (!approved) {
    console.warn(`[ticket] Plantilla "${RESOLVED_TEMPLATE_NAME}" no existe o no está aprobada en Meta todavía — no se notifica al cliente. Creála desde Plantillas cuando esté lista.`);
    await db.collection(COLLECTION).doc(ticket.id).update({ notificationStatus: 'no_template' }).catch(() => {});
    return;
  }
  try {
    await sendWhatsAppTemplate(ticket.contactId, RESOLVED_TEMPLATE_NAME, approved.language ?? 'es_AR', [ticket.titulo]);
    console.log(`[ticket] Notificación de resolución enviada para ticket ${ticket.id}`);
    await db.collection(COLLECTION).doc(ticket.id).update({ notificationStatus: 'sent' }).catch(() => {});
  } catch (err) {
    console.error('[ticket] Error enviando plantilla de resolución:', err.message);
    await db.collection(COLLECTION).doc(ticket.id).update({ notificationStatus: 'failed' }).catch(() => {});
    throw err;
  }
}
