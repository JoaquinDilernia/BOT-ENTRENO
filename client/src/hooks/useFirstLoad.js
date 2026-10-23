import { useEffect, useRef, useState } from 'react';
import { ENTRY_WINDOW_MS, shouldStartEntry } from '../lib/motion';

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// true solo durante la ventana de entrada que sigue al primer loading -> false de este
// montaje; después vuelve a false (lo que se monta más tarde no se anima).
export function useFirstLoad(loading) {
  const prev = useRef(loading);
  const started = useRef(false);
  const [expired, setExpired] = useState(false);
  if (shouldStartEntry(prev.current, loading, started.current, prefersReducedMotion())) {
    started.current = true;
  }
  prev.current = loading;
  const on = started.current;

  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => setExpired(true), ENTRY_WINDOW_MS);
    return () => clearTimeout(t);
  }, [on]);

  return on && !expired;
}
