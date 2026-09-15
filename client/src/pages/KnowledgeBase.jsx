import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './KnowledgeBase.module.css';

const CATEGORIES = ['Info general', 'Envíos', 'Cambios y devoluciones', 'Pagos', 'Tono de marca', 'FAQs', 'Derivación', 'Otro'];

const EMPTY_FORM = { title: '', content: '', category: 'Info general', order: 99, active: true };

export default function KnowledgeBase() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { fetchItems(); }, []);

  async function fetchItems() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(BASE_URL + '/api/knowledge');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setItems(data.items ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let res;
      if (editing) {
        res = await authFetch(BASE_URL + `/api/knowledge/${editing}`, {
          method: 'PUT',
          body: form,
        });
      } else {
        res = await authFetch(BASE_URL + '/api/knowledge', {
          method: 'POST',
          body: form,
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      resetForm();
      await fetchItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este item?')) return;
    await authFetch(BASE_URL + `/api/knowledge/${id}`, { method: 'DELETE' });
    fetchItems();
  }

  async function handleToggle(item) {
    await authFetch(BASE_URL + `/api/knowledge/${item.id}`, {
      method: 'PUT',
      body: { active: !item.active },
    });
    fetchItems();
  }

  function startEdit(item) {
    setEditing(item.id);
    setForm({ title: item.title, content: item.content, category: item.category, order: item.order, active: item.active });
    setShowForm(true);
  }

  function resetForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Knowledge Base</h1>
          <p className={styles.subtitle}>Información que usa el bot para responder</p>
        </div>
        <button className={styles.btnPrimary} onClick={() => { resetForm(); setShowForm(true); }}>
          + Nuevo item
        </button>
      </header>

      {error && (
        <div className={styles.errorBanner}>
          Error: {error}
        </div>
      )}

      {showForm && (        <div className={styles.formCard}>
          <h2 className={styles.formTitle}>{editing ? 'Editar item' : 'Nuevo item'}</h2>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>Título</label>
                <input
                  className={styles.input}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="ej: Política de cambios"
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Categoría</label>
                <select
                  className={styles.input}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Contenido</label>
              <textarea
                className={styles.textarea}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Escribí aquí la información que el bot debe saber..."
                rows={6}
                required
              />
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Cargando...</p>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Sin contenido aún</p>
          <p className={styles.emptyText}>Agregá información para que el bot pueda responder mejor.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <div key={item.id} className={`${styles.card} ${!item.active ? styles.cardInactive : ''}`}>
              <div className={styles.cardTop}>
                <div className={styles.cardMeta}>
                  <span className={styles.cardCategory}>{item.category}</span>
                  <span className={`${styles.cardStatus} ${item.active ? styles.cardStatusActive : styles.cardStatusOff}`}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <p className={styles.cardContent}>{item.content}</p>
              </div>
              <div className={styles.cardActions}>
                <button className={styles.actionBtn} onClick={() => handleToggle(item)}>
                  {item.active ? 'Desactivar' : 'Activar'}
                </button>
                <button className={styles.actionBtn} onClick={() => startEdit(item)}>
                  Editar
                </button>
                <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(item.id)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
