// Helpers puros de presentación de la pantalla de Conversaciones.

export const AVATAR_PALETTE = ['#7c3aed', '#e8473f', '#0ea5e9', '#f59e0b', '#16a34a', '#db2777', '#0f766e', '#6366f1'];

/** Nivel del contador de espera: naranja desde 5 min, rojo desde 15 min. */
export function waitLevel(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return 'none';
  if (minutes < 5) return 'ok';
  if (minutes < 15) return 'warn';
  return 'late';
}

/** Color de avatar estable para un string (teléfono, id, nombre). */
export function avatarColor(seed) {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

/** Píldora de estado de una conversación para la lista. */
export function statusPill(conv, { botName, areaName, agentName } = {}) {
  const bot = botName || 'Bot';
  const status = conv?.status;
  if (status === 'resolved') return { text: 'Resuelta', tone: 'ok' };
  if (status === 'bot_archived') return { text: 'Archivada', tone: 'muted' };
  if (conv?.humanMode) return { text: agentName || 'Equipo', tone: 'agent' };
  if (status === 'escalated') return { text: areaName ? `Esperando · ${areaName}` : 'Esperando', tone: 'wait' };
  return { text: `${bot} respondiendo`, tone: 'bot' };
}

/**
 * `assignedTo` guarda un id de área o un agente (email o id). Devuelve a quién
 * corresponde: un área (derivada, esperando) o un agente (la tomó una persona).
 */
export function resolveAssignee(assignedTo, { areas = [], nameMap = {} } = {}) {
  if (!assignedTo) return { areaName: null, agentName: null };
  const area = areas.find((a) => a.id === assignedTo);
  if (area) return { areaName: area.name, agentName: null };
  return { areaName: null, agentName: nameMap[assignedTo] ?? assignedTo };
}

/**
 * Píldora a partir de la conversación tal como la manda el backend. El backend
 * escala siempre con humanMode=true (también cuando el bot deriva a un área),
 * así que "la atiende una persona" = humanMode + (un agente asignado o alguien
 * del equipo ya respondió en este ciclo: firstAgentResponseAt, que el backend
 * resetea en cada escalamiento). Derivada a un área o sin asignar y sin
 * respuesta cuenta como "Esperando". Misma regla que server/src/services/waiting.js.
 */
export function pillFor(conv, { botName, areas, nameMap } = {}) {
  const { areaName, agentName } = resolveAssignee(conv?.assignedTo, { areas, nameMap });
  const takenByAgent = !!(conv?.humanMode && (agentName || conv?.firstAgentResponseAt));
  const status = conv?.status === 'bot' && conv?.humanMode && !takenByAgent ? 'escalated' : conv?.status;
  return statusPill({ ...conv, status, humanMode: takenByAgent }, { botName, areaName, agentName });
}

/** Hasta 2 iniciales para el avatar. */
export function initials(name) {
  const s = String(name ?? '').trim();
  if (!s) return '?';
  if (/^\+?\d/.test(s)) return s.replace(/\D/g, '').slice(0, 2) || '?';
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function toDate(ts) {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

/** Hora de la lista: hoy "HH:MM", ayer "ayer", antes "DD/MM". */
export function listTime(ts, now = new Date()) {
  const d = toDate(ts);
  if (!d) return '';
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (d >= startYesterday) return 'ayer';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

// ---- Línea de tiempo del chat: separadores de día y avisos de traspaso ----

const AR_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
});
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "YYYY-MM-DD" del día en hora de Argentina. */
function arDay(d) {
  return AR_DAY_FMT.format(d);
}

/** Etiqueta del separador: "HOY", "AYER" o "lun 19 oct". */
function dayLabel(ymd, now) {
  const today = arDay(now);
  if (ymd === today) return 'HOY';
  const [ty, tm, td] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  if (ymd === yesterday) return 'AYER';
  const [y, m, dd] = ymd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return `${WEEKDAYS[wd]} ${dd} ${MONTHS[m - 1]}`;
}

const isBroadcast = (msg) => typeof msg?.content === 'string' && msg.content.startsWith('[Difusión');

/**
 * Tipo de responsable de este mensaje: 'bot', 'agent' o null (cliente / difusión).
 * Solo el cambio de tipo (bot ⇄ agente) genera aviso; entre agentes no.
 */
function responsibleOf(msg) {
  if (isBroadcast(msg)) return null;
  if (msg?.role === 'assistant') return 'bot';
  if (msg?.role === 'admin') return 'agent';
  return null;
}

/**
 * Arma lo que se pinta en el chat: los mensajes intercalados con separadores
 * de día (hora de Argentina) y avisos de traspaso bot ⇄ agente. Es pura sobre
 * el array de mensajes, así que el polling no puede duplicar avisos.
 */
export function buildTimeline(messages, { botName, nameMap = {}, now = new Date() } = {}) {
  const out = [];
  if (!Array.isArray(messages)) return out;
  const bot = botName || 'Bot';
  let lastDay = null;
  let lastResp = null;
  messages.forEach((msg, index) => {
    const d = toDate(msg?.timestamp);
    if (d) {
      const ymd = arDay(d);
      if (ymd !== lastDay) {
        out.push({ kind: 'day', label: dayLabel(ymd, now), key: `day-${ymd}` });
        lastDay = ymd;
      }
    }
    const resp = responsibleOf(msg);
    if (resp) {
      if (lastResp && resp !== lastResp) {
        const text = resp === 'bot'
          ? `${bot} volvió a responder`
          : `${nameMap[msg.sentBy] || 'Alguien del equipo'} tomó la conversación`;
        out.push({ kind: 'handoff', text, key: `handoff-${index}` });
      }
      lastResp = resp;
    }
    out.push({ kind: 'msg', msg, index });
  });
  return out;
}
