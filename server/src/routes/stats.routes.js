import { Router } from 'express';
import admin from 'firebase-admin';
import { getDb } from '../services/firebase.service.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { aggregateConversations, arMidnight, fromArWallClock, toDate, isoDate, previousRange } from '../services/statsAggregate.js';
import { waitingSummary } from '../services/waiting.js';
import { getBotCartStats, reconcileBotCarts } from '../services/botCart.service.js';

const router = Router();
router.use(requireAuth);

const MAX_CUSTOM_DAYS = 92; // ~3 meses, evita tablas/queries desmedidas

function getPeriodRange(period, fromStr, toStr) {
  const now = new Date();

  if (period === 'custom' && fromStr && toStr) {
    // fromStr/toStr son "YYYY-MM-DD" elegidos por el usuario como días
    // calendario en Argentina — se interpretan directamente como tales.
    const start = fromArWallClock(new Date(`${fromStr}T00:00:00Z`));
    let end = fromArWallClock(new Date(`${toStr}T23:59:59.999Z`));
    if (end > now) end = now;
    if (start > end) return { start: end, end };

    const spanDays = Math.floor((end - start) / 86400000) + 1;
    if (spanDays > MAX_CUSTOM_DAYS) {
      const cappedStart = arMidnight(new Date(end.getTime() - (MAX_CUSTOM_DAYS - 1) * 86400000));
      return { start: cappedStart, end };
    }
    return { start, end };
  }

  if (period === 'day') {
    return { start: arMidnight(now), end: now };
  }
  if (period === 'week') {
    return { start: arMidnight(new Date(now.getTime() - 6 * 86400000)), end: now };
  }
  // month (default)
  return { start: arMidnight(new Date(now.getTime() - 29 * 86400000)), end: now };
}

router.get('/', async (req, res) => {
  try {
    const period = req.query.period ?? 'week';
    const db = getDb();
    const { start, end } = getPeriodRange(period, req.query.from, req.query.to);
    const startMs = start.getTime();
    const endMs = end.getTime();

    // Período anterior: el mismo tramo corrido N días enteros (alineado a medianoche).
    const { prevStartMs, prevEndMs } = previousRange(startMs, endMs);

    const convsInRange = (fromMs, toMs) => db.collection('bot-entreno_conversations')
      .where('updatedAt', '>=', admin.firestore.Timestamp.fromMillis(fromMs))
      .where('updatedAt', '<=', admin.firestore.Timestamp.fromMillis(toMs))
      .get();

    const [snap, prevSnap, agentsSnap, areasSnap, urgentSnap, awaitingSnap, configDoc] = await Promise.all([
      convsInRange(startMs, endMs),
      convsInRange(prevStartMs, prevEndMs),
      db.collection('bot-entreno_agents').get(),
      db.collection('bot-entreno_areas').get(),
      db.collection('bot-entreno_conversations').where('urgent', '==', true).get(),
      db.collection('bot-entreno_conversations').where('status', '==', 'escalated').get(),
      db.collection('bot-entreno_config').doc('bot_config').get().catch(() => ({ exists: false, data: () => ({}) })),
    ]);

    const conversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const prevConversations = prevSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const agents = agentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const areas = areasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const botConfig = configDoc.exists ? configDoc.data() : {};

    // Urgentes: siempre "ahora mismo", sin acotar por período (igual criterio
    // que la tarjeta "Pendientes" y el filtro "Urgentes" de Conversaciones).
    const urgentCount = urgentSnap.docs
      .map(d => d.data())
      .filter(c => c.status !== 'resolved' && c.status !== 'bot_archived')
      .length;

    // Esperando agente: AHORA MISMO, sin acotar por período — una conversación
    // derivada hace días y sin responder sigue contando como backlog. Misma
    // regla que la cola de Inicio y la píldora de Conversaciones (waiting.js).
    const { count: awaitingAgent, oldestMin: oldestAwaitingMin } =
      waitingSummary(awaitingSnap.docs.map(d => d.data()), agents);

    const current = aggregateConversations(conversations, { startMs, endMs, agents, areas, botConfig });
    const prev = aggregateConversations(prevConversations, { startMs: prevStartMs, endMs: prevEndMs, agents, areas, botConfig });

    const pending = conversations.filter(c => {
      const s = c.status ?? 'bot';
      return s !== 'resolved' && s !== 'bot_archived';
    }).length;

    res.json({
      period,
      from: isoDate(start),
      to: isoDate(end),
      total: current.total,
      conversationsStarted: current.conversationsStarted,
      resolved: current.resolved,
      resolvedByBot: current.resolvedByBot,
      resolvedByAgent: current.resolvedByAgent,
      botResolutionRate: current.botResolutionRate,
      pending,
      urgentCount,
      awaitingAgent,
      oldestAwaitingMin,
      escalatedCount: current.escalatedCount,
      escalationRate: current.escalationRate,
      avgFirstResponseMin: current.avgFirstResponseMin,
      avgResolutionMin: current.avgResolutionMin,
      byStatus: current.byStatus,
      byChannel: current.byChannel,
      byAgent: current.byAgent,
      byArea: current.byArea,
      labelCounts: current.labelCounts,
      dailyTrend: current.dailyTrend,
      byBusinessHours: current.byBusinessHours,
      byReason: current.byReason,
      previous: {
        total: prev.total,
        conversationsStarted: prev.conversationsStarted,
        resolvedByBot: prev.resolvedByBot,
        resolvedByAgent: prev.resolvedByAgent,
        botResolutionRate: prev.botResolutionRate,
        escalatedCount: prev.escalatedCount,
        escalationRate: prev.escalationRate,
        avgFirstResponseMin: prev.avgFirstResponseMin,
        avgResolutionMin: prev.avgResolutionMin,
      },
    });
  } catch (err) {
    console.error('[stats]', err);
    res.status(500).json({ error: err.message });
  }
});

// Contador liviano de "esperando" (badge del menú, Inicio). Se monta aparte en
// app.js con solo requireAuth: los operadores también lo ven.
export const waitingRouter = Router();
waitingRouter.get('/', async (req, res) => {
  try {
    const db = getDb();
    const [escalatedSnap, agentsSnap] = await Promise.all([
      db.collection('bot-entreno_conversations').where('status', '==', 'escalated').get(),
      db.collection('bot-entreno_agents').get(),
    ]);
    const agents = agentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(waitingSummary(escalatedSnap.docs.map(d => d.data()), agents));
  } catch (err) {
    console.error('[stats/waiting]', err);
    res.status(500).json({ error: err.message });
  }
});

// Conversaciones de una etiqueta en el período — mismo criterio que labelCounts
// (actividad, updatedAt, dentro del rango), así la lista coincide con el número.
router.get('/labels/conversations', async (req, res) => {
  try {
    const label = req.query.label;
    if (!label) return res.status(400).json({ error: 'Falta la etiqueta' });
    const { start, end } = getPeriodRange(req.query.period ?? 'week', req.query.from, req.query.to);
    const snap = await getDb().collection('bot-entreno_conversations')
      .where('updatedAt', '>=', admin.firestore.Timestamp.fromDate(start))
      .where('updatedAt', '<=', admin.firestore.Timestamp.fromDate(end))
      .get();
    const conversations = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => (c.labels ?? []).includes(label))
      .map(c => ({
        id: c.id,
        contactName: c.contactName ?? null,
        channel: c.channel ?? 'whatsapp',
        status: c.status === 'urgent' ? 'bot' : (c.status ?? 'bot'),
        lastActivityAt: toDate(c.updatedAt)?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
    res.json({ label, conversations });
  } catch (err) {
    console.error('[stats/labels]', err);
    res.status(500).json({ error: err.message });
  }
});

// Carritos armados por el bot y cuántos terminaron en venta. Antes de
// responder cruza los pendientes con TiendaNube (si falla, muestra lo último
// que se sabe en vez de romper la pantalla).
router.get('/carts', async (req, res) => {
  try {
    const { start, end } = getPeriodRange(req.query.period ?? 'week', req.query.from, req.query.to);
    await reconcileBotCarts({ maxAgeMs: 5 * 60 * 1000 }).catch(err => console.error('[stats] cruce de carritos:', err.message));
    res.json(await getBotCartStats(start, end));
  } catch (err) {
    console.error('[stats] carritos:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
