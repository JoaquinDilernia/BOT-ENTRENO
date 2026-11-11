import { useCallback, useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Campaigns.module.css';

// Selector de pedidos de Tienda Nube para una difusión: lista los pedidos
// (más nuevos primero, con filtros), se tildan los que se quieran y también
// se puede pegar una lista "#24366 +543435210241" como la que arma el equipo.

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { q: '', status: 'any', paymentStatus: '', shippingStatus: '', from: '', to: '' };

const STATUS_LABEL = { open: 'Abierto', closed: 'Cerrado', cancelled: 'Cancelado' };
const PAYMENT_LABEL = { paid: 'Pagado', pending: 'Pago pendiente', authorized: 'Autorizado', refunded: 'Reintegrado', voided: 'Anulado', abandoned: 'Abandonado' };
const SHIPPING_LABEL = { unpacked: 'Sin empaquetar', unfulfilled: 'Por enviar', fulfilled: 'Enviado', unshipped: 'Por enviar', shipped: 'Enviado' };

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return isNaN(d) ? '—' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtMoney(n) {
  return n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR');
}

export default function CampaignOrderPicker({ selected, onChange }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const [pasting, setPasting] = useState(false);

  const fetchPage = useCallback(async (f, p) => {
    const qs = new URLSearchParams({ page: String(p), perPage: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    const r = await authFetch(`${BASE_URL}/api/campaigns/tn-orders?${qs}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error trayendo pedidos');
    return data;
  }, []);

  const load = useCallback(async (f, p = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchPage(f, p);
      setOrders(prev => (p === 1 ? data.orders : [...prev, ...data.orders]));
      setPage(p);
      setHasMore(data.hasMore);
      if (p === 1) setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  // Recarga con debounce cuando cambian los filtros (la búsqueda se tipea).
  useEffect(() => {
    const t = setTimeout(() => load(filters, 1), 400);
    return () => clearTimeout(t);
  }, [filters, load]);

  function setFilter(patch) { setFilters(p => ({ ...p, ...patch })); }

  function toggle(o) {
    const next = new Map(selected);
    if (next.has(o.number)) next.delete(o.number);
    else next.set(o.number, o);
    onChange(next);
  }

  const selectable = orders.filter(o => o.phone);
  const allPageSelected = selectable.length > 0 && selectable.every(o => selected.has(o.number));

  function togglePage() {
    const next = new Map(selected);
    if (allPageSelected) selectable.forEach(o => next.delete(o.number));
    else selectable.forEach(o => next.set(o.number, o));
    onChange(next);
  }

  /** Acepta líneas tipo "#24366 +543435210241" o sólo "#24366" / "24366".
      Si la línea no trae teléfono, busca el pedido en Tienda Nube. */
  async function applyPaste() {
    const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setPasting(true);
    setPasteMsg('');
    const next = new Map(selected);
    const notFound = [];
    let added = 0;
    for (const line of lines) {
      const m = line.match(/#?\s*(\d{3,})\s*[,;\t ]*\s*(\+?[\d\s()-]{8,})?/);
      if (!m) { notFound.push(line); continue; }
      const number = Number(m[1]);
      const phone = m[2]?.trim() || null;
      if (phone) {
        next.set(number, { ...(next.get(number) ?? {}), number, phone, name: next.get(number)?.name ?? null, products: next.get(number)?.products ?? [] });
        added++;
        continue;
      }
      try {
        const data = await fetchPage({ q: String(number), status: 'any' }, 1);
        const o = data.orders.find(x => Number(x.number) === number);
        if (o?.phone) { next.set(number, o); added++; } else notFound.push(`#${number}${o ? ' (sin teléfono)' : ''}`);
      } catch {
        notFound.push(`#${number}`);
      }
    }
    onChange(next);
    setPasting(false);
    setPasteMsg(`Agregados ${added}.${notFound.length ? ` No se pudieron agregar: ${notFound.join(', ')}` : ''}`);
    if (notFound.length === 0) { setPasteText(''); setPasteOpen(false); }
  }

  const selectedList = [...selected.values()].sort((a, b) => b.number - a.number);

  return (
    <div className={styles.picker}>
      <div className={styles.pickerFilters}>
        <input className={styles.input} type="search" placeholder="Nº de pedido, nombre o email…" value={filters.q} onChange={e => setFilter({ q: e.target.value })} />
        <select className={styles.input} value={filters.status} onChange={e => setFilter({ status: e.target.value })}>
          <option value="any">Todos los estados</option>
          <option value="open">Abiertos</option>
          <option value="closed">Cerrados</option>
          <option value="cancelled">Cancelados</option>
        </select>
        <select className={styles.input} value={filters.paymentStatus} onChange={e => setFilter({ paymentStatus: e.target.value })}>
          <option value="">Cualquier pago</option>
          <option value="paid">Pagados</option>
          <option value="pending">Pago pendiente</option>
        </select>
        <select className={styles.input} value={filters.shippingStatus} onChange={e => setFilter({ shippingStatus: e.target.value })}>
          <option value="">Cualquier envío</option>
          <option value="unpacked">Sin empaquetar</option>
          <option value="unfulfilled">Por enviar</option>
          <option value="fulfilled">Enviados</option>
        </select>
        <label className={styles.pickerDate}>Desde <input className={styles.input} type="date" value={filters.from} onChange={e => setFilter({ from: e.target.value })} /></label>
        <label className={styles.pickerDate}>Hasta <input className={styles.input} type="date" value={filters.to} onChange={e => setFilter({ to: e.target.value })} /></label>
      </div>

      <div className={styles.pickerBar}>
        <span className={styles.hint}>
          {loading && orders.length === 0 ? 'Cargando pedidos…' : total != null ? `${total.toLocaleString('es-AR')} pedidos · mostrando ${orders.length}` : `Mostrando ${orders.length}`}
        </span>
        <div className={styles.pickerBarActions}>
          <button type="button" className={styles.actionBtn} onClick={() => setPasteOpen(o => !o)}>📋 Pegar lista</button>
          <button type="button" className={styles.actionBtn} onClick={togglePage} disabled={selectable.length === 0}>
            {allPageSelected ? 'Destildar los visibles' : 'Tildar los visibles'}
          </button>
          {selected.size > 0 && (
            <button type="button" className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => onChange(new Map())}>Limpiar selección</button>
          )}
        </div>
      </div>

      {pasteOpen && (
        <div className={styles.pastePanel}>
          <p className={styles.hint}>Una línea por pedido: <code>#24366 +543435210241</code> o sólo <code>#24366</code> (el teléfono se busca en Tienda Nube).</p>
          <textarea className={styles.pasteArea} rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={'#24366 +543435210241\n#24445\n24416'} />
          <div className={styles.pickerBarActions}>
            <button type="button" className={styles.btnPrimary} onClick={applyPaste} disabled={pasting || !pasteText.trim()}>
              {pasting ? 'Buscando…' : 'Agregar a la selección'}
            </button>
            {pasteMsg && <span className={styles.hint}>{pasteMsg}</span>}
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.orderTable}>
        <div className={styles.orderHead}>
          <span><input type="checkbox" checked={allPageSelected} onChange={togglePage} aria-label="Tildar los visibles" /></span>
          <span>Pedido</span>
          <span>Cliente</span>
          <span>Productos</span>
          <span>Estado</span>
          <span className={styles.alignRight}>Total</span>
        </div>
        {orders.map(o => {
          const checked = selected.has(o.number);
          return (
            <label key={o.id} className={`${styles.orderRow} ${checked ? styles.orderRowChecked : ''} ${!o.phone ? styles.orderRowDisabled : ''}`}>
              <span><input type="checkbox" checked={checked} disabled={!o.phone} onChange={() => toggle(o)} /></span>
              <span>
                <strong>#{o.number}</strong>
                <span className={styles.orderSub}>{fmtDate(o.createdAt)}</span>
              </span>
              <span>
                {o.name ?? '—'}
                <span className={styles.orderSub}>{o.phone ?? 'sin teléfono'}</span>
              </span>
              <span className={styles.orderProducts} title={o.products.join('\n')}>{o.products.join(' · ') || '—'}</span>
              <span className={styles.orderSub}>
                {STATUS_LABEL[o.status] ?? o.status} · {PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus} · {SHIPPING_LABEL[o.shippingStatus] ?? o.shippingStatus}
              </span>
              <span className={styles.alignRight}>{fmtMoney(o.total)}</span>
            </label>
          );
        })}
        {!loading && orders.length === 0 && !error && <p className={styles.empty}>No hay pedidos con esos filtros.</p>}
      </div>

      {hasMore && (
        <button type="button" className={styles.btnSecondary} onClick={() => load(filters, page + 1)} disabled={loading}>
          {loading ? 'Cargando…' : `Cargar ${PAGE_SIZE} más`}
        </button>
      )}

      {selectedList.length > 0 && (
        <div className={styles.selectedBox}>
          <p className={styles.label}>{selectedList.length} pedido{selectedList.length === 1 ? '' : 's'} elegido{selectedList.length === 1 ? '' : 's'}</p>
          <div className={styles.tagFilterRow}>
            {selectedList.map(o => (
              <button type="button" key={o.number} className={`${styles.tagChip} ${styles.tagChipActive}`} onClick={() => toggle(o)} title="Quitar">
                #{o.number}{o.name ? ` · ${o.name}` : ''} ✕
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
