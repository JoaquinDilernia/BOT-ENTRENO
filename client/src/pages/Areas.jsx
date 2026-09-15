import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import styles from './Areas.module.css';

export default function Areas() {
  const { agent } = useAuth();
  const isAdmin = agent?.role === 'admin';

  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id, name, description, active } | 'new'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await authFetch(BASE_URL + '/api/areas');
      if (r.ok) setAreas((await r.json()).areas ?? []);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setEditing({ id: '', name: '', description: '', active: true });
    setError('');
  }

  function startEdit(area) {
    setEditing({ ...area });
    setError('');
  }

  function cancelEdit() {
    setEditing(null);
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const isNew = !editing.id || !areas.find(a => a.id === editing.id);
      const url = isNew
        ? BASE_URL + '/api/areas'
        : BASE_URL + `/api/areas/${editing.id}`;
      const r = await authFetch(url, {
        method: isNew ? 'POST' : 'PUT',
        body: { name: editing.name, description: editing.description, active: editing.active },
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(area) {
    await authFetch(BASE_URL + `/api/areas/${area.id}`, {
      method: 'PUT',
      body: { active: !area.active },
    });
    setAreas(prev => prev.map(a => a.id === area.id ? { ...a, active: !a.active } : a));
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminás esta área? Las conversaciones asignadas no se van a borrar.')) return;
    await authFetch(BASE_URL + `/api/areas/${id}`, { method: 'DELETE' });
    setAreas(prev => prev.filter(a => a.id !== id));
  }

  if (loading) return <div className={styles.loading}>Cargando...</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Áreas</h1>
          <p className={styles.subtitle}>
            Configurá a qué equipo deriva el bot cada tipo de consulta. La descripción le indica al bot cuándo escalar a cada área.
          </p>
        </div>
        {isAdmin && !editing && (
          <button className={styles.btnPrimary} onClick={startNew}>+ Nueva área</button>
        )}
      </header>

      <div className={styles.body}>
        {editing && (
          <form className={styles.form} onSubmit={handleSave}>
            <h2 className={styles.formTitle}>
              {editing.id && areas.find(a => a.id === editing.id) ? 'Editar área' : 'Nueva área'}
            </h2>
            <div className={styles.field}>
              <label className={styles.label}>Nombre</label>
              <input
                className={styles.input}
                value={editing.name}
                onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                placeholder="Ej: Soporte"
                required
                maxLength={50}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>¿Cuándo escala el bot a esta área?</label>
              <textarea
                className={styles.textarea}
                value={editing.description}
                onChange={e => setEditing(p => ({ ...p, description: e.target.value }))}
                placeholder="Describí los casos en que el bot debe derivar a este equipo. Este texto va directo al modelo de IA."
                rows={4}
                required
              />
              <p className={styles.hint}>Sé específico. Ej: "Clientes que ya contrataron un servicio y tienen una duda o problema puntual."</p>
            </div>
            <div className={styles.field}>
              <label className={styles.toggleLabel}>
                <span>Activa</span>
                <div
                  className={`${styles.toggle} ${editing.active ? styles.toggleOn : ''}`}
                  onClick={() => setEditing(p => ({ ...p, active: !p.active }))}
                  role="checkbox"
                  aria-checked={editing.active}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && setEditing(p => ({ ...p, active: !p.active }))}
                >
                  <div className={styles.toggleThumb} />
                </div>
              </label>
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={cancelEdit}>Cancelar</button>
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}

        <div className={styles.list}>
          {areas.length === 0 && (
            <p className={styles.empty}>No hay áreas configuradas.</p>
          )}
          {areas.map(area => (
            <div key={area.id} className={`${styles.card} ${!area.active ? styles.cardInactive : ''}`}>
              <div className={styles.cardMain}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardName}>
                    <span className={`${styles.activeDot} ${area.active ? styles.activeDotOn : ''}`} />
                    {area.name}
                  </div>
                  <code className={styles.marker}>[ESCALAR_{area.id.toUpperCase()}]</code>
                </div>
                <p className={styles.cardDesc}>{area.description}</p>
              </div>
              {isAdmin && (
                <div className={styles.cardActions}>
                  <button
                    className={`${styles.actionBtn} ${area.active ? styles.actionBtnWarning : styles.actionBtnSuccess}`}
                    onClick={() => toggleActive(area)}
                    title={area.active ? 'Desactivar' : 'Activar'}
                  >
                    {area.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className={styles.actionBtn} onClick={() => startEdit(area)}>Editar</button>
                  <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(area.id)}>Eliminar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
