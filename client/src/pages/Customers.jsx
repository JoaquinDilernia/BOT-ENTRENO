import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Customers.module.css';

const CHANNEL_LABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram' };
const DEFAULT_FORM = { contactName: '', email: '', phone: '', channel: 'whatsapp', tags: [] };
const PAGE_SIZE = 50;
const DEFAULT_ADV = { spentMin: '', spentMonths: '12', product: '', productMonths: '12', orderCountMin: '', lastOrderMaxDays: '', lastOrderMinDays: '' };

function formatDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
    return d.toLocaleDateString('es-AR');
  } catch { return '—'; }
}

async function downloadCsv(url, filename) {
  const res = await authFetch(url);
  if (!res.ok) { alert('No se pudo exportar.'); return; }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [hasOrders, setHasOrders] = useState(false);
  const [form, setForm] = useState(null); // { mode: 'create'|'edit', data }
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [adv, setAdv] = useState(DEFAULT_ADV);
  const [advOpen, setAdvOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const fileInputRef = useRef(null);

  const advKey = JSON.stringify(adv);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (channel) params.set('channel', channel);
      if (activeTags.length) params.set('tags', activeTags.join(','));
      if (hasOrders) params.set('hasOrders', 'true');
      if (adv.spentMin) { params.set('spentMin', adv.spentMin); params.set('spentMonths', adv.spentMonths || '12'); }
      if (adv.product.trim()) { params.set('product', adv.product.trim()); params.set('productMonths', adv.productMonths || '12'); }
      if (adv.orderCountMin) params.set('orderCountMin', adv.orderCountMin);
      if (adv.lastOrderMaxDays) params.set('lastOrderMaxDays', adv.lastOrderMaxDays);
      if (adv.lastOrderMinDays) params.set('lastOrderMinDays', adv.lastOrderMinDays);
      const [custRes, tagsRes] = await Promise.all([
        authFetch(BASE_URL + '/api/customers?' + params.toString()),
        authFetch(BASE_URL + '/api/customers/tags'),
      ]);
      if (custRes.ok) setCustomers((await custRes.json()).customers ?? []);
      if (tagsRes.ok) setAllTags((await tagsRes.json()).tags ?? []);
    } finally {
      setLoading(false);
    }
  }, [q, channel, activeTags, hasOrders, advKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Al cambiar cualquier filtro, volver a la primera "página" del listado.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [q, channel, activeTags, hasOrders, advKey]);

  async function handleSyncTiendaNube() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await authFetch(BASE_URL + '/api/customers/sync-tiendanube', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSyncResult(data);
      await load();
    } catch (err) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  }

  function setAdvField(key, val) { setAdv(p => ({ ...p, [key]: val })); }

  function toggleTagFilter(tag) {
    setActiveTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  function openCreate() {
    setForm({ mode: 'create', data: { ...DEFAULT_FORM } });
    setTagInput('');
    setError('');
  }

  function openEdit(c) {
    setForm({ mode: 'edit', data: { contactId: c.contactId, contactName: c.contactName ?? '', email: c.email ?? '', channel: c.channel, tags: c.tags ?? [] } });
    setTagInput('');
    setError('');
  }

  function cancel() { setForm(null); setError(''); }

  function setField(key, val) {
    setForm(p => ({ ...p, data: { ...p.data, [key]: val } }));
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || form.data.tags.includes(t)) { setTagInput(''); return; }
    setField('tags', [...form.data.tags, t]);
    setTagInput('');
  }

  function removeTag(t) {
    setField('tags', form.data.tags.filter(x => x !== t));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (form.mode === 'create') {
        const { phone, channel: ch, contactName, email, tags } = form.data;
        if (!phone.trim()) throw new Error('El teléfono/identificador es requerido');
        const res = await authFetch(BASE_URL + '/api/customers', {
          method: 'POST',
          body: { phone, channel: ch, contactName, email, tags },
        });
        if (!res.ok) throw new Error((await res.json()).error);
      } else {
        const { contactId, contactName, email, tags } = form.data;
        const res = await authFetch(BASE_URL + `/api/customers/${contactId}`, {
          method: 'PATCH',
          body: { contactName, email, tags },
        });
        if (!res.ok) throw new Error((await res.json()).error);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c) {
    if (!confirm(`¿Eliminar el contacto "${c.contactName || c.contactId}"? Esto no borra su conversación.`)) return;
    await authFetch(BASE_URL + `/api/customers/${c.contactId}`, { method: 'DELETE' });
    setCustomers(prev => prev.filter(x => x.contactId !== c.contactId));
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch(BASE_URL + '/api/customers/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImportResult(data);
      await load();
    } catch (err) {
      setImportResult({ error: err.message });
    } finally {
      setImporting(false);
    }
  }

  const filtered = customers;
  const shown = filtered.slice(0, visibleCount);
  const advActive = adv.spentMin || adv.product.trim() || adv.orderCountMin || adv.lastOrderMaxDays || adv.lastOrderMinDays;
  const anyFilterActive = q.trim() || channel || activeTags.length > 0 || hasOrders || advActive;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Contactos</h1>
          <p className={styles.subtitle}>
            Lista de contactos para segmentar y mandar difusiones. Se completa sola con quien
            escribe al bot, pero también podés cargar o importar contactos a mano.
          </p>
        </div>
        {!form && (
          <div className={styles.headerActions}>
            <button className={styles.btnSecondary} onClick={handleSyncTiendaNube} disabled={syncing} title="Traer todos los clientes de Tienda Nube con teléfono">
              {syncing ? 'Sincronizando…' : '↻ Sincronizar Tienda Nube'}
            </button>
            <button className={styles.btnSecondary} onClick={() => downloadCsv(BASE_URL + '/api/customers/export.csv', 'contactos.csv')}>
              ⬇ Exportar CSV
            </button>
            <button className={styles.btnSecondary} onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importando…' : '⬆ Importar CSV'}
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />
            <button className={styles.btnPrimary} onClick={openCreate}>+ Nuevo contacto</button>
          </div>
        )}
      </header>

      <div className={styles.body}>
        {importResult && (
          <div className={importResult.error ? styles.errorBanner : styles.importBanner}>
            {importResult.error ? (
              `⚠️ ${importResult.error}`
            ) : (
              <>
                ✓ Importación lista: {importResult.created} nuevos, {importResult.updated} actualizados, {importResult.skipped} omitidos.
                {importResult.errors?.length > 0 && ` ${importResult.errors.length} filas con error.`}
              </>
            )}
            <button className={styles.bannerClose} onClick={() => setImportResult(null)}>✕</button>
          </div>
        )}

        {syncResult && (
          <div className={syncResult.error ? styles.errorBanner : styles.importBanner}>
            {syncResult.error
              ? `⚠️ ${syncResult.error}`
              : `✓ Sync Tienda Nube: ${syncResult.created} nuevos, ${syncResult.updated} actualizados${syncResult.skippedNoPhone ? `, ${syncResult.skippedNoPhone} sin teléfono` : ''}.`}
            <button className={styles.bannerClose} onClick={() => setSyncResult(null)}>✕</button>
          </div>
        )}

        {error && !form && <div className={styles.errorBanner}>{error}</div>}

        {form && (
          <form className={styles.form} onSubmit={handleSubmit}>
            <h2 className={styles.formTitle}>
              {form.mode === 'create' ? 'Nuevo contacto' : `Editar: ${form.data.contactName || form.data.contactId}`}
            </h2>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre</label>
                <input className={styles.input} value={form.data.contactName} onChange={e => setField('contactName', e.target.value)} placeholder="Ej: María García" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email (opcional)</label>
                <input className={styles.input} type="email" value={form.data.email} onChange={e => setField('email', e.target.value)} placeholder="maria@correo.com" />
              </div>
            </div>

            {form.mode === 'create' && (
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Canal</label>
                  <select className={styles.input} value={form.data.channel} onChange={e => setField('channel', e.target.value)}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{form.data.channel === 'whatsapp' ? 'Teléfono' : 'ID de Instagram'}</label>
                  <input
                    className={styles.input}
                    value={form.data.phone}
                    onChange={e => setField('phone', e.target.value)}
                    placeholder={form.data.channel === 'whatsapp' ? 'Ej: 11 2345 6789' : 'ID del perfil'}
                    required
                  />
                </div>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Tags (segmentación)</label>
              <div className={styles.tagEditor}>
                {form.data.tags.map(t => (
                  <span key={t} className={styles.tagChip}>
                    {t}
                    <button type="button" onClick={() => removeTag(t)}>×</button>
                  </span>
                ))}
                <input
                  className={styles.tagInput}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                  onBlur={addTag}
                  placeholder="Escribí una tag y Enter…"
                  list="known-tags"
                />
                <datalist id="known-tags">
                  {allTags.map(t => <option key={t} value={t} />)}
                </datalist>
              </div>
            </div>

            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={cancel}>Cancelar</button>
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? 'Guardando…' : form.mode === 'create' ? 'Crear contacto' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}

        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Buscar por nombre, teléfono o email…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <select className={styles.channelSelect} value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="">Todos los canales</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
          </select>
          <label className={styles.ordersFilterLabel}>
            <input type="checkbox" checked={hasOrders} onChange={e => setHasOrders(e.target.checked)} />
            Ya compró (Tienda Nube)
          </label>
          <button
            type="button"
            className={`${styles.clearBtn} ${advActive ? styles.tagFilterChipActive : ''}`}
            onClick={() => setAdvOpen(v => !v)}
          >
            Segmentar por compras {advOpen ? '▲' : '▾'}{advActive ? ' •' : ''}
          </button>
          {anyFilterActive && (
            <button className={styles.clearBtn} onClick={() => { setQ(''); setChannel(''); setActiveTags([]); setHasOrders(false); setAdv(DEFAULT_ADV); }}>
              Limpiar filtros
            </button>
          )}
        </div>

        {advOpen && (
          <div className={styles.advPanel}>
            <div className={styles.advRow}>
              <span className={styles.advLabel}>Gastó ≥ $</span>
              <input className={styles.advInput} type="number" min="0" value={adv.spentMin} onChange={e => setAdvField('spentMin', e.target.value)} placeholder="100000" />
              <span className={styles.advLabel}>en los últimos</span>
              <input className={styles.advInput} type="number" min="1" value={adv.spentMonths} onChange={e => setAdvField('spentMonths', e.target.value)} />
              <span className={styles.advLabel}>meses</span>
            </div>
            <div className={styles.advRow}>
              <span className={styles.advLabel}>Compró un producto que contiene</span>
              <input className={`${styles.advInput} ${styles.advInputWide}`} value={adv.product} onChange={e => setAdvField('product', e.target.value)} placeholder="nombre del producto" />
              <span className={styles.advLabel}>en los últimos</span>
              <input className={styles.advInput} type="number" min="1" value={adv.productMonths} onChange={e => setAdvField('productMonths', e.target.value)} />
              <span className={styles.advLabel}>meses</span>
            </div>
            <div className={styles.advRow}>
              <span className={styles.advLabel}>Tiene ≥</span>
              <input className={styles.advInput} type="number" min="1" value={adv.orderCountMin} onChange={e => setAdvField('orderCountMin', e.target.value)} placeholder="3" />
              <span className={styles.advLabel}>pedidos (histórico)</span>
            </div>
            <div className={styles.advRow}>
              <span className={styles.advLabel}>Última compra hace ≤</span>
              <input className={styles.advInput} type="number" min="1" value={adv.lastOrderMaxDays} onChange={e => setAdvField('lastOrderMaxDays', e.target.value)} placeholder="30" />
              <span className={styles.advLabel}>días (activos)  ·  hace ≥</span>
              <input className={styles.advInput} type="number" min="1" value={adv.lastOrderMinDays} onChange={e => setAdvField('lastOrderMinDays', e.target.value)} placeholder="90" />
              <span className={styles.advLabel}>días (recompra)</span>
            </div>
            <p className={styles.hint}>Los datos de compras se actualizan con "Sincronizar Tienda Nube" (y solo una vez al día automáticamente).</p>
          </div>
        )}

        {allTags.length > 0 && (
          <div className={styles.tagFilterRow}>
            {allTags.map(t => (
              <button
                key={t}
                type="button"
                className={`${styles.tagFilterChip} ${activeTags.includes(t) ? styles.tagFilterChipActive : ''}`}
                onClick={() => toggleTagFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {!loading && (
          <p className={styles.count}>
            {filtered.length > shown.length
              ? `Mostrando ${shown.length} de ${filtered.length} contactos`
              : `${filtered.length} ${filtered.length === 1 ? 'contacto' : 'contactos'}`}
          </p>
        )}

        {loading ? (
          <p className={styles.empty}>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className={styles.empty}>
            {anyFilterActive ? 'Ningún contacto coincide con esos filtros.' : 'Todavía no hay contactos cargados.'}
          </p>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span>Contacto</span>
              <span>Canal</span>
              <span>Compras</span>
              <span>Tags</span>
              <span>Últ. contacto</span>
              <span></span>
            </div>
            {shown.map(c => (
              <div key={c.id} className={styles.tableRow}>
                <div className={styles.custInfo}>
                  <div className={styles.avatar}>{(c.contactName?.[0] ?? '?').toUpperCase()}</div>
                  <div className={styles.custNameWrap}>
                    <span className={styles.custName}>{c.contactName || '(sin nombre)'}</span>
                    <span className={styles.custId}>{c.contactId}</span>
                  </div>
                </div>
                <span className={styles.channelBadge}>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                <span className={styles.dateCell}>{c.tnOrderCount > 0 ? `${c.tnOrderCount} pedido${c.tnOrderCount > 1 ? 's' : ''}` : '—'}</span>
                <div className={styles.tagsCell}>
                  {(c.tags ?? []).length === 0 ? <span className={styles.noTags}>—</span> : c.tags.map(t => (
                    <span key={t} className={styles.deptTag}>{t}</span>
                  ))}
                </div>
                <span className={styles.dateCell}>{formatDate(c.lastContactAt)}</span>
                <div className={styles.rowActions}>
                  <button className={styles.actionBtn} onClick={() => openEdit(c)}>Editar</button>
                  <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(c)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length > shown.length && (
          <button
            className={styles.btnSecondary}
            style={{ alignSelf: 'center' }}
            onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
          >
            Mostrar más ({filtered.length - shown.length} restantes)
          </button>
        )}
      </div>
    </div>
  );
}
