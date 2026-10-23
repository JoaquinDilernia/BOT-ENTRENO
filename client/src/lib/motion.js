export function easeOutCubic(p) {
  const x = Math.min(1, Math.max(0, p));
  return 1 - Math.pow(1 - x, 3);
}

export function countValue(to, elapsedMs, durationMs = 1100) {
  const v = Math.round(to * easeOutCubic(elapsedMs / durationMs));
  return Math.min(Math.max(v, 0), Math.max(to, 0));
}

/** Ventana (ms) de las animaciones de entrada: cubre la más larga (delay + duración) de Inicio, 940 ms + 1.4 s = 2340 ms, y de Estadísticas (~1.9 s), con margen. */
export const ENTRY_WINDOW_MS = 2600;

/** La entrada arranca en el primer paso loading -> false, una sola vez y sin reduced-motion. */
export function shouldStartEntry(wasLoading, loading, alreadyStarted, reducedMotion) {
  return !!wasLoading && !loading && !alreadyStarted && !reducedMotion;
}
