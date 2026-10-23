// Helpers puros de la pantalla Inicio.
import { pillFor, resolveAssignee } from './conversationView';

function toMs(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts.getTime();
  const secs = ts._seconds ?? ts.seconds;
  if (secs) return secs * 1000;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t;
}

/** "18 min", "1 h", "1 h 5 min". */
export function fmt(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Variación porcentual contra el período anterior; null si no hay base. */
export function kpiDelta(curr, prev) {
  if (!prev || curr === null || curr === undefined) return null;
  const v = Math.round(((curr - prev) / prev) * 100);
  return Number.isFinite(v) ? v : null;
}

/** Tiempo relativo: "ahora", "hace 5 min", "hace 2 h", "hace 3 d". */
export function relTime(ts, now = new Date()) {
  const ms = toMs(ts);
  if (ms === null) return '';
  const min = Math.floor((now.getTime() - ms) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} d`;
}

/** Mensajes del bot con el resumen del día (1 o 2). */
export function tediSummary(stats, { botName } = {}) { // eslint-disable-line no-unused-vars
  const { total = 0, resolvedByBot = 0, escalatedCount = 0, awaitingAgent = 0, oldestAwaitingMin } = stats || {};
  if (!total) return ['Todavía no entró nadie hoy. Acá te aviso apenas llegue alguien 👀'];
  const out = [`Hoy ya atendí ${total} ${total === 1 ? 'conversación' : 'conversaciones'} y resolví ${resolvedByBot} yo solo 💪`];
  if (escalatedCount > 0) {
    let s = `Te pasé ${escalatedCount} que necesitaban a alguien del equipo.`;
    s += awaitingAgent > 0
      ? ` ${awaitingAgent} te están esperando, la más vieja hace ${fmt(oldestAwaitingMin)}.`
      : ' Ya están todas atendidas 🙌';
    out.push(s);
  }
  return out;
}

/**
 * Escaladas que todavía no tomó ni respondió nadie del equipo (misma regla que
 * pillFor), de mayor a menor espera. La espera corre desde waitingSince ?? escalatedAt.
 */
export function waitingQueue(conversations, { areas, nameMap, now = new Date() } = {}) {
  return (conversations || [])
    .filter((c) => !c.firstAgentResponseAt && pillFor(c, { areas, nameMap }).tone === 'wait')
    .map((c) => {
      const since = toMs(c.waitingSince) ?? toMs(c.escalatedAt);
      const waitMin = since === null ? 0 : Math.max(0, Math.floor((now.getTime() - since) / 60000));
      return { ...c, waitMin };
    })
    .sort((a, b) => b.waitMin - a.waitMin);
}

const ICON_BY_TONE = { ok: 'ok', wait: 'handoff', agent: 'agent', bot: 'bot' };

/** Las 6 novedades más recientes, en lenguaje humano. */
export function activityFeed(conversations, { botName, areas, nameMap, now = new Date() } = {}) {
  const bot = botName || 'Bot';
  return (conversations || [])
    .map((c) => ({ c, tone: pillFor(c, { botName: bot, areas, nameMap }).tone, at: toMs(c.updatedAt) ?? 0 }))
    .filter((x) => ICON_BY_TONE[x.tone])
    .sort((a, b) => b.at - a.at)
    .slice(0, 6)
    .map(({ c, tone }) => {
      const name = c.contactName || c.contactId || 'un contacto';
      let title;
      if (tone === 'ok') title = `Se resolvió la conversación con ${name}`;
      else if (tone === 'wait') {
        const { areaName } = resolveAssignee(c.assignedTo, { areas, nameMap });
        title = `${bot} derivó a ${name}${areaName ? ` a ${areaName}` : ''}`;
      } else if (tone === 'agent') title = `El equipo atiende a ${name}`;
      else title = `${bot} está hablando con ${name}`;
      return { key: c.id, icon: ICON_BY_TONE[tone], title, sub: relTime(c.updatedAt, now) };
    });
}
