import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Campaigns.module.css';

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando…', sent: 'Enviada' };
const STATUS_CLASS = { draft: 'statusDraft', sending: 'statusSending', sent: 'statusSent' };
const DEFAULT_FORM = { name: '', templateId: '', targetUrl: '', segment: { q: '', channel: '', tags: [] } };

function formatDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [params, setParams] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null); // { campaign, sends }
  const [sending, setSending] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [campRes, tplRes, tagsRes] = await Promise.all([
        authFetch(BASE_URL + '/api/campaigns'),
        authFetch(BASE_URL + '/api/templates'),
        authFetch(BASE_URL + '/api/customers/tags'),
      ]);
      if (campRes.ok) setCampaigns((await campRes.json()).campaigns ?? []);
      // /api/templates devuelve un array plano (mismo endpoint que usa
      // Conversations.jsx) — sólo sirven las que Meta ya aprobó.
      if (tplRes.ok) setTemplates((await tplRes.json()).filter(t => t.metaStatus === 'APPROVED'));
      if (tagsRes.ok) setAllTags((await tagsRes.json()).tags ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function refreshPreview(segment) {
    setPreviewing(true);
    try {
      const r = await authFetch(BASE_URL + '/api/campaigns/preview-segment', { method: 'POST', body: { segment } });
      if (r.ok) setPreview(await r.json());
    } finally {
      setPreviewing(false);
    }
  }

  function openCreate() {
    setForm({ ...DEFAULT_FORM, segment: { q: '', channel: '', tags: [] } });
    setParams([]);
    setPreview(null);
    setError('');
    refreshPreview({ q: '', channel: '', tags: [] });
  }

  function cancel() { setForm(null); setDetail(null); setError(''); }

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }));
  }

  function setSegment(patch) {
    setForm(p => {
      const segment = { ...p.segment, ...patch };
      refreshPreview(segment);
      return { ...p, segment };
    });
  }

  function toggleTag(tag) {
    const tags = form.segment.tags.includes(tag)
      ? form.segment.tags.filter(t => t !== tag)
      : [...form.segment.tags, tag];
    setSegment({ tags });
  }

  function pickTemplate(id) {
    const tpl = templates.find(t => t.id === id);
    setField('templateId', id);
    setParams(tpl?.params?.map(() => '') ?? []);
  }

  const selectedTemplate = templates.find(t => t.id === form?.templateId);

  async function handleCreate(e) {
    e.preventDefault();
    if (!selectedTemplate) { setError('Elegí una plantilla aprobada'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(BASE_URL + '/api/campaigns', {
        method: 'POST',
        body: {
          name: form.name,
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          category: selectedTemplate.category,
          paramsTemplate: params,
          targetUrl: form.targetUrl,
          segment: form.segment,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(null);
      await load();
      openDetail(data.campaign);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(campaignStub) {
    const res = await authFetch(BASE_URL + `/api/campaigns/${campaignStub.id}`);
    if (res.ok) setDetail(await res.json());
  }

  useEffect(() => {
    clearInterval(pollRef.current);
    if (detail?.campaign?.status === 'sending') {
      pollRef.current = setInterval(async () => {
        const res = await authFetch(BASE_URL + `/api/campaigns/${detail.campaign.id}`);
        if (res.ok) {
          const data = await res.json();
          setDetail(data);
          setCampaigns(prev => prev.map(c => c.id === data.campaign.id ? data.campaign : c));
        }
      }, 4000);
    }
    return () => clearInterval(pollRef.current);
  }, [detail?.campaign?.status, detail?.campaign?.id]);

  async function handleSend() {
    if (!detail) return;
    if (!confirm(`¿Mandar "${detail.campaign.name}" a ${preview?.whatsappCount ?? detail.campaign.stats.total} contactos? No se puede deshacer.`)) return;
    setSending(true);
    try {
      const res = await authFetch(BASE_URL + `/api/campaigns/${detail.campaign.id}/send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await openDetail(detail.campaign);
      await load();
    } catch (err) {
      alert(`No se pudo enviar: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(c) {
    if (!confirm(`¿Eliminar la difusión "${c.name}"?`)) return;
    await authFetch(BASE_URL + `/api/campaigns/${c.id}`, { method: 'DELETE' });
    setCampaigns(prev => prev.filter(x => x.id !== c.id));
    if (detail?.campaign?.id === c.id) setDetail(null);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Difusiones</h1>
          <p className={styles.subtitle}>
            Mandá una plantilla aprobada a todos los contactos o a un segmento por tags, y
            mirá cuántos la recibieron, la leyeron y clickearon el link.
          </p>
        </div>
        {!form && !detail && (
          <button className={styles.btnPrimary} onClick={openCreate}>+ Nueva difusión</button>
        )}
      </header>

      <div className={styles.body}>
        {form && (
          <form className={styles.form} onSubmit={handleCreate}>
            <h2 className={styles.formTitle}>Nueva difusión</h2>

            <div className={styles.field}>
              <label className={styles.label}>Nombre (interno, no lo ve el destinatario)</label>
              <input className={styles.input} value={form.name} onChange={e => setField('name', e.target.value)} required placeholder="Ej: Promo octubre" />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Plantilla aprobada</label>
              {templates.length === 0 ? (
                <p className={styles.hint}>No hay plantillas aprobadas todavía. Creá una en la sección Plantillas.</p>
              ) : (
                <select className={styles.input} value={form.templateId} onChange={e => pickTemplate(e.target.value)} required>
                  <option value="">Seleccioná una plantilla…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.displayName} ({t.name})</option>)}
                </select>
              )}
              {selectedTemplate && <p className={styles.templatePreview}>{selectedTemplate.bodyText}</p>}
            </div>

            {selectedTemplate?.params?.length > 0 && (
              <div className={styles.field}>
                <label className={styles.label}>Parámetros de la plantilla</label>
                <p className={styles.hint}>
                  Podés usar <code>{'{{nombre}}'}</code> para el nombre del contacto
                  {form.targetUrl && <> y <code>{'{{link}}'}</code> para el link trackeado</>}.
                </p>
                {selectedTemplate.params.map((desc, i) => (
                  <div key={i} className={styles.paramRow}>
                    <span className={styles.paramLabel}>{`{{${i + 1}}}`} {desc}</span>
                    <input
                      className={styles.input}
                      value={params[i] ?? ''}
                      onChange={e => setParams(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                      placeholder={desc}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Link a trackear (opcional)</label>
              <input className={styles.input} type="url" value={form.targetUrl} onChange={e => setField('targetUrl', e.target.value)} placeholder="https://..." />
              <p className={styles.hint}>Si lo cargás, usalo como <code>{'{{link}}'}</code> en algún parámetro — cada contacto recibe un link corto propio para poder contar los clicks.</p>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Segmento</label>
              <div className={styles.segmentRow}>
                <input
                  className={styles.input}
                  type="search"
                  placeholder="Buscar por nombre/teléfono…"
                  value={form.segment.q}
                  onChange={e => setSegment({ q: e.target.value })}
                />
                <select className={styles.input} value={form.segment.channel} onChange={e => setSegment({ channel: e.target.value })}>
                  <option value="">Todos los canales</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
              {allTags.length > 0 && (
                <div className={styles.tagFilterRow}>
                  {allTags.map(t => (
                    <button
                      type="button"
                      key={t}
                      className={`${styles.tagChip} ${form.segment.tags.includes(t) ? styles.tagChipActive : ''}`}
                      onClick={() => toggleTag(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <p className={styles.previewCount}>
                {previewing ? 'Calculando…' : preview ? (
                  <>📤 <strong>{preview.whatsappCount}</strong> contactos de WhatsApp van a recibir este mensaje{preview.total !== preview.whatsappCount ? ` (de ${preview.total} en el segmento)` : ''}.</>
                ) : ''}
              </p>
            </div>

            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={cancel}>Cancelar</button>
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar borrador'}
              </button>
            </div>
          </form>
        )}

        {detail && (
          <div className={styles.detailPanel}>
            <div className={styles.detailHead}>
              <div>
                <h2 className={styles.formTitle}>{detail.campaign.name}</h2>
                <p className={styles.hint}>
                  Plantilla: {detail.campaign.templateName} · Creada {formatDate(detail.campaign.createdAt)}
                </p>
              </div>
              <button className={styles.btnSecondary} onClick={cancel}>← Volver</button>
            </div>

            <div className={styles.statsGrid}>
              <Stat label="Total" value={detail.campaign.stats.total} />
              <Stat label="Enviados" value={detail.campaign.stats.sent} />
              <Stat label="Fallidos" value={detail.campaign.stats.failed} tone="danger" />
              <Stat label="Entregados" value={detail.campaign.stats.delivered} />
              <Stat label="Leídos" value={detail.campaign.stats.read} tone="info" />
              <Stat label="Clicks" value={detail.campaign.stats.clicked} tone="success" />
            </div>

            {detail.campaign.status === 'draft' && (
              <button className={styles.btnPrimary} onClick={handleSend} disabled={sending}>
                {sending ? 'Enviando…' : '🚀 Enviar difusión ahora'}
              </button>
            )}
            {detail.campaign.status === 'sending' && (
              <p className={styles.hint}>Enviando… esto se actualiza solo cada pocos segundos.</p>
            )}
          </div>
        )}

        {!form && !detail && (
          loading ? (
            <p className={styles.empty}>Cargando…</p>
          ) : campaigns.length === 0 ? (
            <p className={styles.empty}>Todavía no creaste ninguna difusión.</p>
          ) : (
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>Nombre</span>
                <span>Plantilla</span>
                <span>Estado</span>
                <span>Estadísticas</span>
                <span>Fecha</span>
                <span></span>
              </div>
              {campaigns.map(c => (
                <div key={c.id} className={styles.tableRow}>
                  <button className={styles.campaignNameBtn} onClick={() => openDetail(c)}>{c.name}</button>
                  <span className={styles.muted}>{c.templateName}</span>
                  <span className={`${styles.statusBadge} ${styles[STATUS_CLASS[c.status]] ?? ''}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
                  <span className={styles.muted}>
                    {c.stats.sent}/{c.stats.total} · {c.stats.read} leídos · {c.stats.clicked} clicks
                  </span>
                  <span className={styles.muted}>{formatDate(c.sentAt ?? c.createdAt)}</span>
                  <div className={styles.rowActions}>
                    {c.status === 'draft' && (
                      <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(c)}>Eliminar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`${styles.statCard} ${tone ? styles[`stat_${tone}`] : ''}`}>
      <span className={styles.statValue}>{value ?? 0}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
