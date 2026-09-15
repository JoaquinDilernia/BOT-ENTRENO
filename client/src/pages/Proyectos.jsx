import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import styles from './Proyectos.module.css';

const EMPTY_CONTACT = { nombre: '', telefono: '', email: '' };
const EMPTY_PROJECT = { nombre: '', empresa: '', descripcion: '', estado: 'activo', contactos: [] };

export default function Proyectos() {
  const { agent } = useAuth();
  const canEdit = agent?.role === 'admin' || agent?.role === 'atencion_cliente';

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // objeto proyecto en edición, o null
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await authFetch(BASE_URL + '/api/projects');
      if (r.ok) setProjects((await r.json()).projects ?? []);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setEditing({ ...EMPTY_PROJECT, contactos: [{ ...EMPTY_CONTACT }] });
    setError('');
  }

  function startEdit(project) {
    setEditing({ ...project, contactos: project.contactos?.length ? project.contactos.map(c => ({ ...c })) : [{ ...EMPTY_CONTACT }] });
    setError('');
  }

  function cancelEdit() {
    setEditing(null);
    setError('');
  }

  function updateContact(idx, field, value) {
    setEditing(prev => ({
      ...prev,
      contactos: prev.contactos.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    }));
  }

  function addContact() {
    setEditing(prev => ({ ...prev, contactos: [...prev.contactos, { ...EMPTY_CONTACT }] }));
  }

  function removeContact(idx) {
    setEditing(prev => ({ ...prev, contactos: prev.contactos.filter((_, i) => i !== idx) }));
  }

  async function save() {
    if (!editing.nombre.trim() || !editing.empresa.trim()) {
      setError('Nombre y empresa son requeridos');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const contactos = editing.contactos.filter(c => c.telefono.trim());
      const body = { ...editing, contactos };
      const isNew = !editing.id;
      const r = await authFetch(BASE_URL + '/api/projects' + (isNew ? '' : `/${editing.id}`), {
        method: isNew ? 'POST' : 'PUT',
        body,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error ?? 'Error guardando el proyecto');
        return;
      }
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar este proyecto? Los tickets ya vinculados no se borran, pero quedan sin proyecto asociado.')) return;
    const r = await authFetch(BASE_URL + `/api/projects/${id}`, { method: 'DELETE' });
    if (r.ok) load();
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Proyectos</h1>
          <p className={styles.subtitle}>Clientes y proyectos — vinculá los contactos de WhatsApp de cada uno para que el bot arme tickets con el proyecto correcto.</p>
        </div>
        {canEdit && !editing && (
          <button className={styles.newBtn} onClick={startNew}>+ Nuevo proyecto</button>
        )}
      </div>

      {editing && (
        <div className={styles.editCard}>
          <h2 className={styles.editTitle}>{editing.id ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Nombre del proyecto</span>
              <input value={editing.nombre} onChange={e => setEditing({ ...editing, nombre: e.target.value })} placeholder="Ej: Bot Cliente X" />
            </label>
            <label className={styles.field}>
              <span>Empresa</span>
              <input value={editing.empresa} onChange={e => setEditing({ ...editing, empresa: e.target.value })} placeholder="Ej: Empresa SRL" />
            </label>
          </div>
          <label className={styles.field}>
            <span>Descripción (opcional)</span>
            <textarea rows={2} value={editing.descripcion} onChange={e => setEditing({ ...editing, descripcion: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Estado</span>
            <select value={editing.estado} onChange={e => setEditing({ ...editing, estado: e.target.value })}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>

          <div className={styles.contactsBlock}>
            <span className={styles.contactsLabel}>Contactos vinculados</span>
            {editing.contactos.map((c, idx) => (
              <div key={idx} className={styles.contactRow}>
                <input placeholder="Nombre" value={c.nombre} onChange={e => updateContact(idx, 'nombre', e.target.value)} />
                <input placeholder="Teléfono (ej: 5491100000001)" value={c.telefono} onChange={e => updateContact(idx, 'telefono', e.target.value)} />
                <input placeholder="Email" value={c.email} onChange={e => updateContact(idx, 'email', e.target.value)} />
                <button type="button" className={styles.removeContactBtn} onClick={() => removeContact(idx)} title="Quitar contacto">✕</button>
              </div>
            ))}
            <button type="button" className={styles.addContactBtn} onClick={addContact}>+ Agregar contacto</button>
          </div>

          <div className={styles.editActions}>
            <button className={styles.cancelBtn} onClick={cancelEdit} disabled={saving}>Cancelar</button>
            <button className={styles.saveBtn} onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Cargando...</p>
      ) : projects.length === 0 ? (
        <p className={styles.empty}>No hay proyectos cargados todavía.</p>
      ) : (
        <div className={styles.list}>
          {projects.map(p => (
            <div key={p.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardName}>{p.nombre}</span>
                <span className={`${styles.statusBadge} ${p.estado === 'activo' ? styles.statusActive : styles.statusInactive}`}>{p.estado}</span>
              </div>
              <span className={styles.cardEmpresa}>{p.empresa}</span>
              {p.descripcion && <p className={styles.cardDesc}>{p.descripcion}</p>}
              <div className={styles.cardContacts}>
                {(p.contactos ?? []).map((c, i) => (
                  <span key={i} className={styles.contactChip}>{c.nombre || c.telefono}</span>
                ))}
              </div>
              {canEdit && (
                <div className={styles.cardActions}>
                  <button className={styles.editBtn} onClick={() => startEdit(p)}>Editar</button>
                  <button className={styles.deleteBtn} onClick={() => remove(p.id)}>Eliminar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
