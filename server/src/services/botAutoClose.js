import { getDb } from './firebase.service.js';

const COLLECTION = 'bot-entreno_conversations';

// Una charla que atendió solo el bot casi nunca termina con un "chau" que
// dispare [CERRAR]: el cliente recibe la respuesta y se va. Sin este cierre
// quedaban en 'bot' para siempre, nunca tenían resolvedAt y la estadística
// "resolvió el bot solo" las ignoraba (solo contaba los cierres manuales de
// los agentes, que son justamente las derivadas).
export const BOT_IDLE_CLOSE_MS = 6 * 60 * 60 * 1000;

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

/**
 * ¿Hay que cerrar sola esta conversación? Devuelve la fecha del último
 * mensaje (que se usa como resolvedAt) o null.
 */
export function autoCloseAt(conv, now = Date.now(), idleMs = BOT_IDLE_CLOSE_MS) {
  if ((conv.status ?? 'bot') !== 'bot' || conv.humanMode) return null;
  const messages = conv.messages ?? [];
  const last = messages[messages.length - 1];
  // Si lo último lo escribió el cliente, quedó sin respuesta: no es "resuelta".
  if (!last || last.role === 'user') return null;
  if (!messages.some(m => m.role === 'assistant')) return null;
  const lastAt = toDate(last.timestamp);
  if (!lastAt || now - lastAt.getTime() < idleMs) return null;
  return lastAt;
}

export async function closeIdleBotConversations() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).where('status', '==', 'bot').get();
  let closed = 0;
  for (const doc of snap.docs) {
    const conv = doc.data();
    const lastAt = autoCloseAt(conv);
    if (!lastAt) continue;
    await doc.ref.update({
      status: 'bot_archived',
      resolvedAt: lastAt,
      resolvedBy: conv.assignedTo ?? null,
      waitingSince: null,
      autoClosed: true,
      updatedAt: new Date(),
    });
    closed++;
  }
  if (closed) console.log(`[autoClose] ${closed} conversaciones inactivas del bot archivadas`);
  return closed;
}
