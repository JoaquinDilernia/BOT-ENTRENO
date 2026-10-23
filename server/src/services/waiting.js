// Regla única de "esperando a alguien del equipo" (la misma que usa el panel
// en client/src/lib/conversationView.js → pillFor):
//   - escalada (o status 'bot' con humanMode, caso legado), y
//   - no la tomó un agente (assignedTo no es el id ni el email de un agente), y
//   - nadie del equipo respondió todavía en este ciclo de escalamiento
//     (firstAgentResponseAt se resetea en cada escalamiento).
import { toDate } from './statsAggregate.js';

/** Set de claves (id y email) que identifican a un agente. */
export function agentKeySet(agents = []) {
  const keys = new Set();
  for (const a of agents) {
    if (a?.id) keys.add(a.id);
    if (a?.email) keys.add(a.email);
  }
  return keys;
}

export function isWaiting(conv, agentKeys = new Set()) {
  if (!conv) return false;
  const status = conv.status ?? 'bot';
  const escalated = status === 'escalated' || (status === 'bot' && conv.humanMode === true);
  if (!escalated) return false;
  if (conv.assignedTo && agentKeys.has(conv.assignedTo)) return false;
  if (conv.firstAgentResponseAt) return false;
  return true;
}

/** Cuántas esperan y hace cuántos minutos (enteros) espera la más vieja. */
export function waitingSummary(conversations = [], agents = [], now = new Date()) {
  const keys = agentKeySet(agents);
  const waiting = conversations.filter(c => isWaiting(c, keys));
  if (!waiting.length) return { count: 0, oldestMin: null };
  const nowMs = now.getTime();
  const mins = waiting.map(c => {
    const since = toDate(c.waitingSince) ?? toDate(c.escalatedAt);
    return since ? Math.max(0, Math.floor((nowMs - since.getTime()) / 60000)) : 0;
  });
  return { count: waiting.length, oldestMin: Math.max(...mins) };
}
