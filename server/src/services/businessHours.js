const TZ = 'America/Argentina/Buenos_Aires';

// true si `date` cae dentro del horario de atención, evaluado en hora Argentina.
export function isWithinBusinessHoursAt(date, botConfig = {}) {
  const now = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  const day = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const timeMin = now.getHours() * 60 + now.getMinutes();

  const startH = botConfig.businessHoursStart ?? 9;
  const endH   = botConfig.businessHoursEnd   ?? 18;
  const days   = botConfig.businessDays        ?? [1, 2, 3, 4, 5]; // lun-vie

  return days.includes(day) && timeMin >= startH * 60 && timeMin < endH * 60;
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Para estadísticas ("día vs noche"): usa el horario por día que se carga en
// Config (`businessHours.schedule.{monday..sunday}: { open, close, active }`,
// hora Argentina). Si no hay schedule, cae al horario plano de
// isWithinBusinessHoursAt (lun-vie 9-18 por defecto). El bot NO usa esta función.
export function isWithinConfiguredHoursAt(date, botConfig = {}) {
  const schedule = botConfig?.businessHours?.schedule;
  if (!schedule || typeof schedule !== 'object') return isWithinBusinessHoursAt(date, botConfig);

  const now = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  const day = schedule[DAY_KEYS[now.getDay()]];
  if (!day || day.active === false) return false;
  const open = hhmmToMin(day.open);
  const close = hhmmToMin(day.close);
  if (open === null || close === null) return false;
  const timeMin = now.getHours() * 60 + now.getMinutes();
  return timeMin >= open && timeMin < close;
}
