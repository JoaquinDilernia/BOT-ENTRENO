import { getDb } from './firebase.service.js';
import admin from 'firebase-admin';

const COLLECTION = 'bot-entreno_conversations';

// Valid statuses: bot, escalated, bot_archived, resolved
// 'urgent' is now a boolean flag (data.urgent), not a status
// Legacy docs with status === 'urgent' are treated as status: 'bot', urgent: true

export async function getOrCreateConversation(contactId, channel, contactName = null) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();

  if (doc.exists) {
    const data = doc.data();
    if (contactName && !data.contactName) {
      await docRef.update({ contactName });
    }
    return { id: doc.id, ...data };
  }

  const newConversation = {
    contactId,
    channel,
    contactName: contactName ?? null,
    messages: [],
    status: 'bot',
    humanMode: false,
    assignedTo: null,
    urgent: false,
    unread: 0,
    consecutiveClientMessages: 0,
    lastClientMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await docRef.set(newConversation);
  console.log(`[conv] Nueva conversación creada: ${contactId} (${channel})`);
  return { id: contactId, ...newConversation };
}

export async function appendMessage(contactId, message) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);

  const doc = await docRef.get();
  const docData = doc.exists ? doc.data() : {};
  const current = docData.messages ?? [];
  const { messageId, ...rest } = message;
  const stored = { ...rest, timestamp: new Date() };
  if (message.role === 'user' && messageId) stored.waMsgId = messageId;
  const updated = [...current, stored].slice(-200);

  const CRITICAL_THRESHOLD = 4;

  const extra = {};
  if (message.role === 'user') {
    const nextConsecutive = (docData.consecutiveClientMessages ?? 0) + 1;
    extra.unread = admin.firestore.FieldValue.increment(1);
    extra.lastClientMessageAt = new Date();
    extra.consecutiveClientMessages = nextConsecutive;
    // SLA: start waiting timer when client writes to an agent-handled conversation
    if (docData.humanMode && !docData.waitingSince) {
      extra.waitingSince = new Date();
    }
    // Auto-critical: 4+ consecutive messages without agent response
    if (nextConsecutive >= CRITICAL_THRESHOLD && !docData.critical) {
      extra.critical = true;
      console.log(`[conv] Conversación ${contactId} marcada como crítica (${nextConsecutive} msgs consecutivos)`);
    }
  } else {
    // Any non-user message (bot or agent) resets the consecutive counter
    extra.consecutiveClientMessages = 0;
    // SLA: response received — clear waiting timer
    if (docData.waitingSince) extra.waitingSince = null;
    // Track first agent response after escalation (for response-time metrics)
    if (message.role === 'admin' && docData.humanMode && !docData.firstAgentResponseAt) {
      extra.firstAgentResponseAt = new Date();
    }
    // Clear critical flag when agent responds
    if (message.role === 'admin' && docData.critical) {
      extra.critical = false;
    }
  }

  await docRef.update({ messages: updated, updatedAt: new Date(), ...extra });
}

export async function getConversationHistory(contactId) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(contactId).get();
  return doc.exists ? doc.data().messages ?? [] : [];
}

export async function updateConversationStatus(contactId, status) {
  const db = getDb();
  const update = { status, updatedAt: new Date() };
  if (status === 'resolved' || status === 'bot_archived') {
    update.resolvedAt = new Date();
    update.waitingSince = null;
  }
  await db.collection(COLLECTION).doc(contactId).update(update);
}

export async function updateHumanMode(contactId, humanMode) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({
    humanMode: !!humanMode,
    updatedAt: new Date(),
  });
}

export async function updateAssignment(contactId, assignedTo) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({
    assignedTo: assignedTo ?? null,
    updatedAt: new Date(),
  });
}

export async function setUrgentFlag(contactId, urgent) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({
    urgent: !!urgent,
    updatedAt: new Date(),
  });
}

export async function dispatchConversation(contactId, patch) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);

  // Read current state to detect transitions (needed for escalatedAt / resolvedAt)
  const docSnap = await docRef.get();
  const current = docSnap.exists ? docSnap.data() : {};

  const update = { updatedAt: new Date() };

  if (patch.status !== undefined) {
    update.status = patch.status;
    const wasAlreadyClosed = ['resolved', 'bot_archived'].includes(current.status);
    if ((patch.status === 'resolved' || patch.status === 'bot_archived') && !wasAlreadyClosed) {
      update.resolvedAt = new Date();
      update.waitingSince = null;
      // Quién tenía la conversación asignada AL MOMENTO de cerrarla — se
      // guarda aparte porque el patch de cierre (ej. bot_archive) suele
      // resetear assignedTo a null en el mismo update, y las estadísticas
      // de "por agente/área" necesitan saber quién la cerró, no que quedó
      // sin asignar. Sin esto, todo cierre manual se atribuye a "Bot".
      update.resolvedBy = current.assignedTo ?? null;
    }
  }
  if (patch.humanMode !== undefined) {
    update.humanMode = !!patch.humanMode;
    if (patch.humanMode === true && !current.humanMode) {
      // Conversation transitioning to human-handled — record escalation time
      update.escalatedAt = new Date();
      update.firstAgentResponseAt = null; // reset for this escalation cycle
    }
    if (patch.humanMode === false) {
      update.waitingSince = null;
    }
  }
  if (patch.assignedTo !== undefined) update.assignedTo = patch.assignedTo ?? null;
  if (patch.urgent !== undefined) update.urgent = !!patch.urgent;

  await docRef.update(update);
}

export async function addLabelToConversation(contactId, label) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({
    labels: admin.firestore.FieldValue.arrayUnion(label),
    updatedAt: new Date(),
  });
}

export async function removeLabelFromConversation(contactId, label) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({
    labels: admin.firestore.FieldValue.arrayRemove(label),
    updatedAt: new Date(),
  });
}

export async function markAsRead(contactId) {
  const db = getDb();
  await db.collection(COLLECTION).doc(contactId).update({ unread: 0 });
}

// Update a specific message's delivery status by local msgId
export async function updateMessageStatus(contactId, msgId, newStatus, waMsgId = null) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();
  if (!doc.exists) return;
  const messages = doc.data().messages ?? [];
  const updated = messages.map(m => {
    if (m.msgId !== msgId) return m;
    const result = { ...m, msgStatus: newStatus };
    if (waMsgId) result.waMsgId = waMsgId;
    return result;
  });
  await docRef.update({ messages: updated });
}

// Update a specific message's transcript by mediaId (audios entrantes no tienen msgId)
export async function setMessageTranscript(contactId, mediaId, transcript) {
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();
  if (!doc.exists) return;
  const messages = doc.data().messages ?? [];
  const updated = messages.map(m => m.mediaId === mediaId ? { ...m, transcript } : m);
  await docRef.update({ messages: updated });
}

// Update a specific message's delivery status by WA message ID (for webhook
// delivery receipts). `contactId` viene del `recipient_id` que manda Meta en
// el mismo webhook de status — como el documento de conversación está
// indexado por contactId, alcanza con un get() directo. Antes esto buscaba
// por un campo `lastWaMsgId` a nivel conversación que nunca se escribía en
// ningún lado: la búsqueda siempre volvía vacía y los estados 'delivered'/
// 'read' jamás se aplicaban (bug presente desde que existe esta función).
const STATUS_RANK = { sending: 0, sent: 1, delivered: 2, read: 3 };

export async function updateMessageStatusByWaMsgId(contactId, waMsgId, newStatus) {
  if (!contactId) return;
  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(contactId);
  const doc = await docRef.get();
  if (!doc.exists) return;
  const messages = doc.data().messages ?? [];
  const updated = messages.map(m => {
    if (m.waMsgId !== waMsgId) return m;
    // No pisar un estado más avanzado si el webhook llega desordenado
    // (ej. 'delivered' después de 'read') — 'error' es terminal y siempre gana.
    if (newStatus !== 'error') {
      const currentRank = STATUS_RANK[m.msgStatus] ?? 0;
      const nextRank = STATUS_RANK[newStatus] ?? 0;
      if (nextRank < currentRank) return m;
    }
    return { ...m, msgStatus: newStatus };
  });
  await docRef.update({ messages: updated });
}

function mapConversationDoc(doc, data) {
  const lastMsg = data.messages?.slice(-1)[0];

  // Legacy support: status === 'urgent' treated as status: 'bot', urgent: true
  const rawStatus = data.status ?? 'bot';
  const effectiveStatus = rawStatus === 'urgent' ? 'bot' : rawStatus;
  const isUrgent = data.urgent === true || rawStatus === 'urgent';

  return {
    id: doc.id,
    contactId: data.contactId,
    contactName: data.contactName ?? null,
    channel: data.channel,
    status: effectiveStatus,
    humanMode: data.humanMode ?? false,
    assignedTo: data.assignedTo ?? null,
    urgent: isUrgent,
    critical: data.critical === true,
    unread: data.unread ?? 0,
    labels: data.labels ?? [],
    messageCount: data.messages?.length ?? 0,
    lastMessage: lastMsg?.content ?? '',
    lastMessageAt: lastMsg?.timestamp ?? data.updatedAt,
    lastClientMessageAt: data.lastClientMessageAt ?? null,
    consecutiveClientMessages: data.consecutiveClientMessages ?? 0,
    waitingSince: data.waitingSince ?? null,
    escalatedAt: data.escalatedAt ?? null,
    firstAgentResponseAt: data.firstAgentResponseAt ?? null,
    updatedAt: data.updatedAt,
    createdAt: data.createdAt,
  };
}

export async function listConversations(filters = {}) {
  const db = getDb();
  const snapshot = await db.collection(COLLECTION).orderBy('updatedAt', 'desc').limit(200).get();

  let docs = snapshot.docs.map((doc) => mapConversationDoc(doc, doc.data()));

  if (filters.channel) docs = docs.filter(d => d.channel === filters.channel);
  if (filters.status)  docs = docs.filter(d => d.status === filters.status);
  if (filters.assignedTo) {
    const targets = Array.isArray(filters.assignedTo) ? filters.assignedTo : [filters.assignedTo];
    docs = docs.filter(d => targets.includes(d.assignedTo));
  }

  return docs;
}

export async function listArchivedConversations() {
  const db = getDb();
  const snapshot = await db.collection(COLLECTION)
    .where('status', 'in', ['resolved', 'bot_archived'])
    .get();
  return snapshot.docs
    .map(doc => mapConversationDoc(doc, doc.data()))
    .sort((a, b) => tsToMs(b.updatedAt) - tsToMs(a.updatedAt));
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  const d = new Date(ts);
  return isNaN(d) ? 0 : d.getTime();
}

function matchesText(data, qLower) {
  const name = (data.contactName || '').toLowerCase();
  const contactId = (data.contactId || '').toLowerCase();
  if (name.includes(qLower) || contactId.includes(qLower)) return true;
  const messages = data.messages ?? [];
  return messages.some(m => (m.content || '').toLowerCase().includes(qLower));
}

export async function searchConversations(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const qLower = q.toLowerCase();

  const db = getDb();
  const snapshot = await db.collection(COLLECTION).get();
  const entries = snapshot.docs.map(doc => ({ doc, data: doc.data() }));

  const textMatchEntries = entries.filter(({ data }) => matchesText(data, qLower));

  return textMatchEntries
    .map(({ doc, data }) => mapConversationDoc(doc, data))
    .sort((a, b) => tsToMs(b.updatedAt) - tsToMs(a.updatedAt))
    .slice(0, 100);
}
