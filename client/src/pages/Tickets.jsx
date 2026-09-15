import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Tickets.module.css';

const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];
const ESTADOS = ['abierto', 'en_progreso', 'resuelto', 'cerrado'];
const EMPTY_TICKET = { titulo: '', descripcion: '', prioridad: 'media', proyectoId: '', contactId: '' };

function TicketImage({ mediaId }) {
  const token = localStorage.getItem('bot_token');
  return (
    <img
      className={styles.ticketImg}
      src={`${BASE_URL}/api/conversations/media/${mediaId}?token=${encodeURIComponent(token)}`}
      alt="Adjunto del ticket"
      onError={e => { e.target.onerror = null; e.target.replaceWith(Object.assign(document.createElement('span'), { className: styles.imageExpired, textContent: '⚠️ Imagen no disponible (puede haber expirado)' })); }}
    />
  );
}

export default function Tickets() {
  const [tickets, setTickets] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filterEstado, setFilterEstado] = useState('');
  const [filterPrioridad, setFilterPrioridad] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newTicket, setNewTicket] = useState(EMPTY_TICKET);
  const [newImage, setNewImage] = useState(null); // { mediaId, mimeType } tras subir
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  useEffect(() => { load(); loadProjects(); }, [filterEstado, filterPrioridad]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterEstado) params.set('estado', filterEstado);
      if (filterPrioridad) params.set('prioridad', filterPrioridad);
      const r = await authFetch(BASE_URL + '/api/tickets?' + params.toString());
      if (r.ok) {
        const data = await r.json();
        setTickets(data.tickets ?? []);
        // Si el ticket seleccionado sigue en la lista nueva, refrescá su
        // referencia (por si cambió estado desde otra pestaña); si no, deselecciona.
        setSelected(prev => (prev ? data.tickets?.find(t => t.id === prev.id) ?? null : null));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadProjects() {
    const r = await authFetch(BASE_URL + '/api/projects');
    if (r.ok) setProjects((await r.json()).projects ?? []);
  }

  function projectName(id) {
    return projects.find(p => p.id === id)?.nombre ?? null;
  }

  async function updateSelected(patch) {
    if (!selected) return;
    const r = await authFetch(BASE_URL + `/api/tickets/${selected.id}`, { method: 'PUT', body: patch });
    if (r.ok) {
      const { ticket } = await r.json();
      setSelected(ticket);
      setTickets(prev => prev.map(t => (t.id === ticket.id ? ticket : t)));
    }
  }

  async function addComment() {
    if (!commentText.trim() || !selected) return;
    setSavingComment(true);
    try {
      const r = await authFetch(BASE_URL + `/api/tickets/${selected.id}/comments`, { method: 'POST', body: { texto: commentText.trim() } });
      if (r.ok) {
        const { comentarios } = await r.json();
        setSelected(prev => ({ ...prev, comentarios }));
        setCommentText('');
      }
    } finally {
      setSavingComment(false);
    }
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await authFetch(BASE_URL + '/api/tickets/upload-image', { method: 'POST', body: form });
      if (r.ok) {
        const data = await r.json();
        setNewImage(data);
      } else {
        const data = await r.json().catch(() => ({}));
        alert(`⚠️ ${data.error ?? 'Error subiendo la imagen'}`);
      }
    } finally {
      setUploadingImage(false);
    }
  }

  async function createTicket() {
    if (!newTicket.titulo.trim() || !newTicket.descripcion.trim()) return;
    setSaving(true);
    try {
      const body = {
        ...newTicket,
        proyectoId: newTicket.proyectoId || null,
        contactId: newTicket.contactId || null,
        imagenes: newImage ? [newImage] : [],
      };
      const r = await authFetch(BASE_URL + '/api/tickets', { method: 'POST', body });
      if (r.ok) {
        setShowNew(false);
        setNewTicket(EMPTY_TICKET);
        setNewImage(null);
        load();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <aside className={styles.list}>
        <div className={styles.listHeader}>
          <h1 className={styles.title}>Tickets</h1>
          <div className={styles.headerActions}>
            <button className={styles.refreshBtn} onClick={load} title="Actualizar">🔄</button>
            <button className={styles.newBtn} onClick={() => setShowNew(true)}>+ Nuevo</button>
          </div>
        </div>
        <div className={styles.filters}>
          <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e} value={e}>{e.replace('_', ' ')}</option>)}
          </select>
          <select value={filterPrioridad} onChange={e => setFilterPrioridad(e.target.value)}>
            <option value="">Toda prioridad</option>
            {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {loading ? (
          <p className={styles.empty}>Cargando...</p>
        ) : tickets.length === 0 ? (
          <p className={styles.empty}>No hay tickets.</p>
        ) : (
          tickets.map(t => (
            <button key={t.id} className={`${styles.ticketItem} ${selected?.id === t.id ? styles.ticketItemActive : ''}`} onClick={() => setSelected(t)}>
              <span className={styles.ticketItemTitle}>{t.titulo}</span>
              <div className={styles.ticketItemMeta}>
                <span className={`${styles.badge} ${styles['prio_' + t.prioridad]}`}>{t.prioridad}</span>
                <span className={`${styles.badge} ${styles['estado_' + t.estado]}`}>{t.estado.replace('_', ' ')}</span>
              </div>
              {projectName(t.proyectoId) && <span className={styles.ticketItemProject}>{projectName(t.proyectoId)}</span>}
            </button>
          ))
        )}
      </aside>

      <main className={styles.detail}>
        {showNew ? (
          <div className={styles.newForm}>
            <h2>Nuevo ticket</h2>
            <label className={styles.field}>
              <span>Título</span>
              <input value={newTicket.titulo} onChange={e => setNewTicket({ ...newTicket, titulo: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Descripción</span>
              <textarea rows={4} value={newTicket.descripcion} onChange={e => setNewTicket({ ...newTicket, descripcion: e.target.value })} />
            </label>
            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Prioridad</span>
                <select value={newTicket.prioridad} onChange={e => setNewTicket({ ...newTicket, prioridad: e.target.value })}>
                  {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Proyecto (opcional)</span>
                <select value={newTicket.proyectoId} onChange={e => setNewTicket({ ...newTicket, proyectoId: e.target.value })}>
                  <option value="">Sin proyecto</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
            </div>
            <label className={styles.field}>
              <span>Teléfono de contacto (opcional — para poder notificarle cuando se resuelva)</span>
              <input value={newTicket.contactId} onChange={e => setNewTicket({ ...newTicket, contactId: e.target.value })} placeholder="5491100000001" />
            </label>
            <label className={styles.field}>
              <span>Imagen (opcional)</span>
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={uploadingImage} />
              {newImage && <span className={styles.imageOk}>✓ Imagen subida</span>}
            </label>
            <div className={styles.formActions}>
              <button onClick={() => { setShowNew(false); setNewImage(null); setNewTicket(EMPTY_TICKET); }} disabled={saving}>Cancelar</button>
              <button className={styles.primaryBtn} onClick={createTicket} disabled={saving || uploadingImage}>{saving ? 'Creando...' : 'Crear ticket'}</button>
            </div>
          </div>
        ) : !selected ? (
          <p className={styles.empty}>Seleccioná un ticket de la lista.</p>
        ) : (
          <div className={styles.ticketDetail}>
            <h2 className={styles.detailTitle}>{selected.titulo}</h2>
            {selected.estado === 'resuelto' && selected.notificationStatus === 'no_template' && (
              <div className={styles.notifyWarning}>⚠️ El cliente no fue notificado — falta crear/aprobar la plantilla "ticket_resuelto" en Plantillas.</div>
            )}
            {selected.estado === 'resuelto' && selected.notificationStatus === 'failed' && (
              <div className={styles.notifyWarning}>⚠️ Falló el envío de la notificación al cliente. Revisá los logs del servidor.</div>
            )}
            {selected.estado === 'resuelto' && selected.notificationStatus === 'sent' && (
              <div className={styles.notifyOk}>✓ Cliente notificado por WhatsApp.</div>
            )}
            <p className={styles.detailDesc}>{selected.descripcion}</p>

            <div className={styles.detailRow}>
              <label>
                <span>Estado</span>
                <select value={selected.estado} onChange={e => updateSelected({ estado: e.target.value })}>
                  {ESTADOS.map(e => <option key={e} value={e}>{e.replace('_', ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Prioridad</span>
                <select value={selected.prioridad} onChange={e => updateSelected({ prioridad: e.target.value })}>
                  {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>

            {selected.proyectoId && (
              <p className={styles.detailMeta}><strong>Proyecto:</strong> {projectName(selected.proyectoId) ?? selected.proyectoId}</p>
            )}
            <p className={styles.detailMeta}><strong>Creado por:</strong> {selected.createdBy === 'bot' ? '🤖 Bot' : selected.createdBy}</p>
            <p className={styles.detailMeta}><strong>Asignado a:</strong> {selected.assignedTo ?? 'Sin asignar'}</p>
            {selected.contactId && (
              <p className={styles.detailMeta}>
                <strong>Contacto:</strong> {selected.contactId}{' '}
                <a href={`#/conversations?contact=${selected.contactId}`} className={styles.convLink}>Ver conversación →</a>
              </p>
            )}

            {selected.imagenes?.length > 0 && (
              <div className={styles.imageGrid}>
                {selected.imagenes.map((img, i) => <TicketImage key={i} mediaId={img.mediaId} />)}
              </div>
            )}

            <div className={styles.comments}>
              <h3>Seguimiento</h3>
              {(selected.comentarios ?? []).map((c, i) => (
                <div key={i} className={styles.commentItem}>
                  <span className={styles.commentAuthor}>{c.autor}</span>
                  <p className={styles.commentText}>{c.texto}</p>
                </div>
              ))}
              <div className={styles.commentForm}>
                <textarea rows={2} value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Agregar update..." />
                <button onClick={addComment} disabled={savingComment || !commentText.trim()}>{savingComment ? '...' : 'Comentar'}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
