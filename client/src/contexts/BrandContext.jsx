import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { authFetch, BASE_URL } from '../lib/api';
import { brandVars, normalizeHex, DEFAULT_BRAND } from '../lib/brand';

const DEFAULTS = { botName: 'Entreno', brandColor: DEFAULT_BRAND, businessName: 'Entreno' };

const BrandContext = createContext({ ...DEFAULTS, updateBrand: () => {} });

export function BrandProvider({ children }) {
  const { agent } = useAuth();
  const [brand, setBrand] = useState(DEFAULTS);

  useEffect(() => {
    if (!agent) return undefined;
    let alive = true;
    // /api/config/brand está abierto a cualquier rol (operadores incluidos).
    authFetch(BASE_URL + '/api/config/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!alive || !c) return;
        setBrand({
          botName: c.botName || DEFAULTS.botName,
          brandColor: normalizeHex(c.brandColor),
          businessName: c.businessName ?? DEFAULTS.businessName,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [agent]);

  useEffect(() => {
    const style = document.documentElement.style;
    Object.entries(brandVars(brand.brandColor)).forEach(([k, v]) => style.setProperty(k, v));
  }, [brand.brandColor]);

  // Lo usa Config para reflejar cambios sin recargar.
  const updateBrand = useCallback((partial) => {
    setBrand((prev) => ({
      ...prev,
      ...partial,
      brandColor: normalizeHex(partial.brandColor ?? prev.brandColor),
    }));
  }, []);

  const value = useMemo(() => ({ ...brand, updateBrand }), [brand, updateBrand]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
