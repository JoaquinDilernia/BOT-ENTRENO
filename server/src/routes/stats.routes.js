import { Router } from 'express';
import admin from 'firebase-admin';
import { getDb } from '../services/firebase.service.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

const MAX_CUSTOM_DAYS = 92; // ~3 meses, evita tablas/queries desmedidas

// Este bot opera en Argentina (UTC-3 fijo, sin horario de verano desde 2009).
// Los "días" de las estadísticas (períodos y desglose diario) deben calcularse
// en ese huso horario SIEMPRE, sin importar en qué TZ corra el proceso Node
// (en Railway/producción suele ser UTC por default). Si esto se calculara con
// el TZ del proceso, un mensaje enviado entre las 21:00 y 23:59 hora Argentina
// caería en el día siguiente cuando el server corre en UTC.
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

// Reinterpreta un instante real como si sus componentes UTC fueran la hora de
// pared en Argentina (para poder usar getUTC*/setUTC* como si fueran locales).
function toArWallClock(date) {
  return new Date(date.getTime() - AR_OFFSET_MS);
}

// Inverso de toArWallClock: vuelve del "reloj de pared ARG" al instante real.
function fromArWallClock(wallClockDate) {
  return new Date(wallClockDate.getTime() + AR_OFFSET_MS);
}

// 00:00:00.000 hora Argentina del día calendario que contiene `date`, como instante real.
function arMidnight(date) {
  const wall = toArWallClock(date);
  wall.setUTCHours(0, 0, 0, 0);
  return fromArWallClock(wall);
}

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

function toDate(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  return new Date(val);
}

// Clave de día calendario en horario de Argentina (ver nota de AR_OFFSET_MS arriba).
function isoDate(d) {
  return toArWallClock(d).toISOString().slice(0, 10);
}

function diffMin(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  return (db - da) / 60000;
}

function isInRange(ts, startMs, endMs) {
  const d = toDate(ts);
  return !!d && d.getTime() >= startMs && d.getTime() <= endMs;
}

function resolveAreaForAssignee(assignee, areaIds, agentsByEmail) {
  if (!assignee) return null;
  if (areaIds.has(assignee)) return assignee;
  const agent = agentsByEmail.get(assignee);
  return (agent?.areaIds ?? []).find(id => areaIds.has(id)) ?? null;
}

router.get('/', async (req, res) => {
  try {
    const period = req.query.period ?? 'week';
    const db = getDb();
    const { start, end } = getPeriodRange(period, req.query.from, req.query.to);
    const startTs = admin.firestore.Timestamp.fromDate(start);
    const endTs = admin.firestore.Timestamp.fromDate(end);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const [snap, agentsSnap, areasSnap, urgentSnap, awaitingSnap] = await Promise.all([
      db.collection('bot-entreno_conversations')
        .where('updatedAt', '>=', startTs)
        .where('updatedAt', '<=', endTs)
        .get(),
      db.collection('bot-entreno_agents').get(),
      db.collection('bot-entreno_areas').get(),
      db.collection('bot-entreno_conversations').where('urgent', '==', true).get(),
      db.collection('bot-entreno_conversations').where('status', '==', 'escalated').get(),
    ]);

    const conversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const agents = agentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const areas = areasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const areaIds = new Set(areas.map(a => a.id));
    const agentsByEmail = new Map(agents.map(a => [a.email, a]));

    // Urgentes: siempre "ahora mismo", sin acotar por período (igual criterio
    // que la tarjeta "Pendientes" y el filtro "Urgentes" de Conversaciones).
    const urgentCount = urgentSnap.docs
      .map(d => d.data())
      .filter(c => c.status !== 'resolved' && c.status !== 'bot_archived')
      .length;

    // Esperando agente: cuántas conversaciones escaladas siguen sin resolver
    // AHORA MISMO, sin acotar por período — una conversación derivada hace
    // días y sin responder todavía debe seguir contando como backlog, aunque
    // no tenga actividad "de hoy".
    const awaitingDocs = awaitingSnap.docs.map(d => d.data());
    const awaitingAgent = awaitingDocs.length;
    const now = new Date();
    const oldestAwaitingMin = awaitingDocs.length
      ? Math.max(...awaitingDocs.map(c => diffMin(c.escalatedAt, now) ?? 0))
      : null;

    // --- Buckets ---
    const agentBuckets = { bot: { handled: 0, resolved: 0 } };
    for (const a of agents) agentBuckets[a.email] = { handled: 0, resolved: 0 };
    for (const area of areas) agentBuckets[area.id] = { handled: 0, resolved: 0 };

    const areaBuckets = {};
    for (const area of areas) areaBuckets[area.id] = { name: area.name, handled: 0, resolved: 0, avgFirstResponseMin: null, _responseSamples: [] };

    const byStatus  = { bot: 0, escalated: 0, resolved: 0, bot_archived: 0 };
    const byChannel = { whatsapp: 0, instagram: 0 };
    const labelMap  = {};

    // Desglose diario: conversaciones nuevas, resueltas por bot/agente, derivadas
    const dayMap = {};
    function dayBucket(key) {
      if (!dayMap[key]) dayMap[key] = { started: 0, resolvedByBot: 0, escalated: 0, resolvedByAgent: 0 };
      return dayMap[key];
    }

    let escalatedCount = 0;
    let conversationsStarted = 0;
    let resolvedByBot = 0;
    let resolvedByAgent = 0;
    const firstResponseSamples = [];
    const resolutionSamples = [];

    for (const conv of conversations) {
      const rawStatus = conv.status ?? 'bot';
      const status    = rawStatus === 'urgent' ? 'bot' : rawStatus; // legado: 'urgent' era status, ahora es flag
      const channel   = conv.channel ?? 'whatsapp';
      const isClosed  = status === 'resolved' || status === 'bot_archived';
      // Una conversación cerrada casi siempre tiene assignedTo en null (las
      // acciones de cierre lo limpian), así que atribuir por el asignado
      // ACTUAL la mandaría siempre al balde "Bot", aunque la haya cerrado un
      // agente o un área. `resolvedBy` guarda quién la tenía al momento del
      // cierre — se usa solo para conversaciones ya cerradas, con fallback
      // al asignado actual para datos viejos sin ese campo.
      const assignee = isClosed
        ? (conv.resolvedBy !== undefined ? (conv.resolvedBy ?? 'bot') : (conv.assignedTo ?? 'bot'))
        : (conv.assignedTo ?? 'bot');

      if (status in byStatus)   byStatus[status]++;
      if (channel in byChannel) byChannel[channel]++;

      const bucket = agentBuckets[assignee] ?? agentBuckets['bot'];
      bucket.handled++;
      if (isClosed) bucket.resolved++;

      // Area breakdown — resolver el área real aunque el asignado (actual o
      // al cierre) sea un agente puntual que tomó un caso derivado (take_over)
      const resolvedArea = resolveAreaForAssignee(assignee, areaIds, agentsByEmail);
      if (resolvedArea && areaBuckets[resolvedArea]) {
        areaBuckets[resolvedArea].handled++;
        if (isClosed) areaBuckets[resolvedArea].resolved++;
      }

      // Escalación: sólo las ocurridas dentro del rango
      if (isInRange(conv.escalatedAt, startMs, endMs)) {
        escalatedCount++;
        const dKey = isoDate(toDate(conv.escalatedAt));
        dayBucket(dKey).escalated++;

        const respMin = diffMin(conv.escalatedAt, conv.firstAgentResponseAt);
        if (respMin !== null && respMin >= 0 && respMin < 24 * 60) {
          firstResponseSamples.push(respMin);
          if (resolvedArea) areaBuckets[resolvedArea]._responseSamples.push(respMin);
        }
      }

      // Resolución: sólo las ocurridas dentro del rango, separadas por si
      // la conversación necesitó escalar en algún momento o no.
      if (isInRange(conv.resolvedAt, startMs, endMs)) {
        const dKey = isoDate(toDate(conv.resolvedAt));
        if (conv.escalatedAt) {
          resolvedByAgent++;
          dayBucket(dKey).resolvedByAgent++;
        } else {
          resolvedByBot++;
          dayBucket(dKey).resolvedByBot++;
        }
      }

      // Resolution time: createdAt → resolvedAt
      const resMin = diffMin(conv.createdAt, conv.resolvedAt);
      if (resMin !== null && resMin >= 0 && resMin < 7 * 24 * 60) {
        resolutionSamples.push(resMin);
      }

      for (const lbl of conv.labels ?? []) {
        labelMap[lbl] = (labelMap[lbl] ?? 0) + 1;
      }

      // Conversaciones nuevas: sólo las iniciadas dentro del rango
      if (isInRange(conv.createdAt, startMs, endMs)) {
        conversationsStarted++;
        dayBucket(isoDate(toDate(conv.createdAt))).started++;
      }
    }

    // --- Desglose diario completo (incluye días en 0) ---
    // `start` ya es medianoche ARG exacta (arMidnight en getPeriodRange), y
    // Argentina no tiene horario de verano, así que sumar 86400000ms por día
    // da siempre la siguiente medianoche ARG — sin usar setHours/setDate en
    // el TZ del proceso, que es justo lo que causaba el desfase de día.
    const dailyTrend = [];
    {
      const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      for (let i = 0; i < totalDays; i++) {
        const key = isoDate(new Date(start.getTime() + i * 86400000));
        const b = dayMap[key] ?? { started: 0, resolvedByBot: 0, escalated: 0, resolvedByAgent: 0 };
        dailyTrend.push({ date: key, ...b });
      }
    }

    // --- Derived metrics ---
    const total = conversations.length;
    const resolved = resolvedByBot + resolvedByAgent;
    // % de las conversaciones RESUELTAS que el bot cerró sin derivar a un agente.
    const botHandledPct = resolved > 0 ? Math.round((resolvedByBot / resolved) * 100) : 0;
    const pending = conversations.filter(c => {
      const s = c.status ?? 'bot';
      return s !== 'resolved' && s !== 'bot_archived';
    }).length;

    const escalationRate = total > 0 ? Math.round((escalatedCount / total) * 100) : 0;

    const avg = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
    const avgFirstResponseMin = avg(firstResponseSamples);
    const avgResolutionMin = avg(resolutionSamples);

    const labelCounts = Object.entries(labelMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Las conversaciones derivadas a un área (sin asignar todavía a
    // una persona puntual) ya se cuentan en "Por área" — antes acá
    // se agregaba una fila extra "{área} (área.)" con el mismo número,
    // que se veía como un agente fantasma duplicado.
    const byAgent = [
      { id: 'bot', name: 'Bot (Asistente)', ...agentBuckets['bot'] },
      ...agents.map(a => ({
        id: a.id,
        name: a.name ?? a.email,
        ...(agentBuckets[a.email] ?? { handled: 0, resolved: 0 }),
      })),
    ];

    const byArea = areas
      .map(area => ({
        id: area.id,
        name: area.name,
        handled: areaBuckets[area.id]?.handled ?? 0,
        resolved: areaBuckets[area.id]?.resolved ?? 0,
        avgFirstResponseMin: avg(areaBuckets[area.id]?._responseSamples ?? []),
      }))
      .filter(a => a.handled > 0)
      .sort((a, b) => b.handled - a.handled);

    res.json({
      period,
      from: isoDate(start),
      to: isoDate(end),
      total,
      conversationsStarted,
      resolved,
      resolvedByBot,
      resolvedByAgent,
      botResolutionRate: botHandledPct,
      pending,
      urgentCount,
      awaitingAgent,
      oldestAwaitingMin,
      escalatedCount,
      escalationRate,
      avgFirstResponseMin,
      avgResolutionMin,
      byStatus,
      byChannel,
      byAgent,
      byArea,
      labelCounts,
      dailyTrend,
    });
  } catch (err) {
    console.error('[stats]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
