import { isWithinConfiguredHoursAt } from './businessHours.js';

// El negocio opera en Argentina (UTC-3 fijo, sin horario de verano desde 2009).
// Los "días" de las estadísticas (períodos y desglose diario) deben calcularse
// en ese huso horario SIEMPRE, sin importar en qué TZ corra el proceso Node
// (en Railway/producción suele ser UTC por default). Si esto se calculara con
// el TZ del proceso, un mensaje enviado entre las 21:00 y 23:59 hora Argentina
// caería en el día siguiente cuando el server corre en UTC.
export const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

// Reinterpreta un instante real como si sus componentes UTC fueran la hora de
// pared en Argentina (para poder usar getUTC*/setUTC* como si fueran locales).
export function toArWallClock(date) {
  return new Date(date.getTime() - AR_OFFSET_MS);
}

// Inverso de toArWallClock: vuelve del "reloj de pared ARG" al instante real.
export function fromArWallClock(wallClockDate) {
  return new Date(wallClockDate.getTime() + AR_OFFSET_MS);
}

// 00:00:00.000 hora Argentina del día calendario que contiene `date`, como instante real.
export function arMidnight(date) {
  const wall = toArWallClock(date);
  wall.setUTCHours(0, 0, 0, 0);
  return fromArWallClock(wall);
}

export function toDate(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  return new Date(val);
}

// Clave de día calendario en horario de Argentina (ver nota de AR_OFFSET_MS arriba).
export function isoDate(d) {
  return toArWallClock(d).toISOString().slice(0, 10);
}

export function diffMin(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  return (db - da) / 60000;
}

// Período anterior para comparar: el mismo tramo corrido N días enteros hacia
// atrás (N = días que abarca el rango actual, mínimo 1). Así "Hoy" a las 10:00
// se compara con ayer 00:00–10:00, y "7 días" con los 7 días previos.
export function previousRange(startMs, endMs) {
  const nDays = Math.max(1, Math.ceil((endMs - startMs) / 86400000));
  const shift = nDays * 86400000;
  return { prevStartMs: startMs - shift, prevEndMs: endMs - shift, nDays };
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

// Agrega las conversaciones de un rango [startMs, endMs]. `startMs` debe ser una
// medianoche ARG exacta (así lo arma getPeriodRange). No incluye lo que es
// "ahora mismo" (urgentes, esperando agente, pendientes): eso lo calcula el handler.
export function aggregateConversations(conversations, { startMs, endMs, agents = [], areas = [], botConfig = {} }) {
  const areaIds = new Set(areas.map(a => a.id));
  const agentsByEmail = new Map(agents.map(a => [a.email, a]));

  // --- Buckets ---
  const agentBuckets = { bot: { handled: 0, resolved: 0 } };
  for (const a of agents) agentBuckets[a.email] = { handled: 0, resolved: 0 };
  for (const area of areas) agentBuckets[area.id] = { handled: 0, resolved: 0 };

  // "Por agente" cuenta quién RESPONDIÓ, no a quién quedó asignada: las
  // derivaciones quedan asignadas al área, así que el agente que las
  // contesta casi no aparecía. Los mensajes de agentes guardan sentBy (email).
  const repliedBuckets = { bot: { replied: 0, messages: 0, resolved: 0 } };
  for (const a of agents) repliedBuckets[a.email] = { replied: 0, messages: 0, resolved: 0 };

  const areaBuckets = {};
  for (const area of areas) areaBuckets[area.id] = { name: area.name, handled: 0, resolved: 0, avgFirstResponseMin: null, _responseSamples: [] };

  const byStatus  = { bot: 0, escalated: 0, resolved: 0, bot_archived: 0 };
  const byChannel = { whatsapp: 0, instagram: 0 };
  const labelMap  = {};
  const byBusinessHours = { inside: 0, outside: 0 };

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

    // Respuestas dentro del período: bot = role 'assistant'; agente = role
    // 'admin' con sentBy. Las difusiones también llevan sentBy (quien la
    // creó) pero no son una respuesta → se excluyen por su prefijo.
    const repliedHere = new Set();
    for (const m of conv.messages ?? []) {
      if (!isInRange(m.timestamp, startMs, endMs)) continue;
      let key = null;
      if (m.role === 'assistant') key = 'bot';
      else if (m.role === 'admin' && !String(m.content ?? '').startsWith('[Difusión')) key = m.sentBy ?? null;
      if (!key || !repliedBuckets[key]) continue;
      repliedBuckets[key].messages++;
      repliedHere.add(key);
    }
    const closedHere = status === 'resolved' || status === 'bot_archived';
    for (const key of repliedHere) {
      repliedBuckets[key].replied++;
      if (closedHere) repliedBuckets[key].resolved++;
    }

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
      // Día vs noche: según la hora a la que se creó la conversación
      byBusinessHours[isWithinConfiguredHoursAt(toDate(conv.createdAt), botConfig) ? 'inside' : 'outside']++;
    }
  }

  // --- Desglose diario completo (incluye días en 0) ---
  // `startMs` es medianoche ARG exacta, y Argentina no tiene horario de verano,
  // así que sumar 86400000ms por día da siempre la siguiente medianoche ARG —
  // sin usar setHours/setDate en el TZ del proceso, que es justo lo que
  // causaba el desfase de día.
  const dailyTrend = [];
  {
    const totalDays = Math.floor((endMs - startMs) / 86400000) + 1;
    for (let i = 0; i < totalDays; i++) {
      const key = isoDate(new Date(startMs + i * 86400000));
      const b = dayMap[key] ?? { started: 0, resolvedByBot: 0, escalated: 0, resolvedByAgent: 0 };
      dailyTrend.push({ date: key, ...b });
    }
  }

  // --- Derived metrics ---
  const total = conversations.length;
  const resolved = resolvedByBot + resolvedByAgent;
  // % de las conversaciones RESUELTAS que el bot cerró sin derivar a un agente.
  const botResolutionRate = resolved > 0 ? Math.round((resolvedByBot / resolved) * 100) : 0;

  const escalationRate = total > 0 ? Math.round((escalatedCount / total) * 100) : 0;

  const avg = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
  const avgFirstResponseMin = avg(firstResponseSamples);
  const avgResolutionMin = avg(resolutionSamples);

  // Todas las etiquetas (antes se cortaba al top 8 y las chicas no se podían ver).
  // Las conversaciones de cada etiqueta se piden aparte (/labels/conversations)
  // al tocarla, para no mandar miles de filas en cada carga.
  const labelCounts = Object.entries(labelMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Las conversaciones derivadas a un área (sin asignar todavía a
  // una persona puntual) ya se cuentan en "Por área" — antes acá
  // se agregaba una fila extra "{área} (área.)" con el mismo número,
  // que se veía como un agente fantasma duplicado.
  // handled = conversaciones en las que respondió en el período;
  // resolved: bot = cerradas sin agente (resolvedBy); agentes = cerradas en
  // las que respondió (el cierre suele quedar a nombre del área).
  const byAgent = [
    { id: 'bot', name: 'Bot (Asistente)', handled: repliedBuckets.bot.replied, messages: repliedBuckets.bot.messages, resolved: agentBuckets.bot.resolved },
    ...agents.map(a => ({
      id: a.id,
      name: a.name ?? a.email,
      handled: repliedBuckets[a.email]?.replied ?? 0,
      messages: repliedBuckets[a.email]?.messages ?? 0,
      resolved: repliedBuckets[a.email]?.resolved ?? 0,
    })),
  ].sort((x, y) => (x.id === 'bot' ? -1 : y.id === 'bot' ? 1 : y.handled - x.handled));

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

  return {
    total,
    conversationsStarted,
    resolved,
    resolvedByBot,
    resolvedByAgent,
    botResolutionRate,
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
    byBusinessHours,
  };
}
