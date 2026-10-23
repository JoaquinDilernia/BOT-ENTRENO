// Helpers puros de presentación de la pantalla de Estadísticas.

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Variación contra el período anterior. `null` si no hay base de comparación
 * (prev null/undefined/0): la UI muestra "—".
 * kind: 'pct' (porcentaje), 'abs' (puntos), 'min' (diferencia de minutos: <1 min en segundos).
 * goodWhen: hacia dónde es "bueno" que vaya el número.
 */
export function delta(curr, prev, { kind, goodWhen } = {}) {
  if (!isNum(curr) || !isNum(prev) || prev === 0) return null;
  const diff = curr - prev;
  let n;
  let unit = '';
  if (kind === 'pct') {
    n = Math.round((diff / prev) * 100);
    unit = '%';
  } else if (kind === 'min') {
    const secs = Math.round(diff * 60);
    if (Math.abs(secs) < 60) { n = secs; unit = 's'; } else { n = Math.round(diff); unit = 'm'; }
  } else {
    n = Math.round(diff);
  }
  if (n === 0) return { text: '=', good: true };
  const text = `${n > 0 ? '+' : '-'}${Math.abs(n)}${unit}`;
  return { text, good: goodWhen === 'down' ? n < 0 : n > 0 };
}

function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Serie para las barras apiladas: lo que resolvió el bot y lo que atendió el equipo. */
export function stackedDays(dailyTrend, { today = localIso() } = {}) {
  return (dailyTrend ?? []).map((d) => {
    const started = Number(d.started) || 0;
    const bot = Number(d.resolvedByBot) || 0;
    const label = d.date === today ? 'Hoy' : WEEKDAYS[new Date(`${d.date}T12:00:00`).getDay()];
    return { label, bot, team: Math.max(started - bot, 0) };
  });
}
