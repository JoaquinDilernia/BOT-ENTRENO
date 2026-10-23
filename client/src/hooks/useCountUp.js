import { useEffect, useRef, useState } from 'react';
import { countValue } from '../lib/motion';

const DURATION = 1100;

export function useCountUp(value, { animate } = { animate: false }) {
  const [shown, setShown] = useState(animate ? 0 : value);
  const done = useRef(false);

  useEffect(() => {
    if (!animate || done.current) return undefined;
    const to = Number(value) || 0;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const elapsed = now - start;
      setShown(countValue(to, elapsed));
      if (elapsed < DURATION) raf = requestAnimationFrame(tick);
      else { setShown(to); done.current = true; }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, animate]);

  // Sin animación, o ya animado una vez: el valor entra directo (sin contar de nuevo).
  if (!animate || done.current) return value;
  return shown;
}
