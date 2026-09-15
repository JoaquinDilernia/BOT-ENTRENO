import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Labels.module.css';

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
];

export default function Labels() {
  const [labels, setLabels] = useState([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadLabels(); }, []);

  async function loadLabels() {
    const r = await authFetch(BASE_URL + '/api/labels');
    if (r.ok) setLabels(await r.json());
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const r = await authFetch(BASE_URL + '/api/labels', { method: 'POST', body: { name: name.trim(), color } });
      if (!r.ok) throw new Error((await r.json()).error);
      setName('');
      await loadLabels();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    await authFetch(BASE_URL + `/api/labels/${id}`, { method: 'DELETE' });
    setLabels(prev => prev.filter(l => l.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Etiquetas</h1>
        <p className={styles.subtitle}>Gestioná las etiquetas que usa el bot y los agentes para clasificar conversaciones.</p>
      </div>

      <div className={styles.body}>
        <form className={styles.form} onSubmit={handleCreate}>
          <input
            className={styles.input}
            type="text"
            placeholder="Nombre de la etiqueta"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={30}
          />
          <div className={styles.palette}>
            {PALETTE.map(c => (
              <button
                key={c}
                type="button"
                className={`${styles.swatch} ${color === c ? styles.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.createBtn} type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Guardando…' : 'Crear etiqueta'}
          </button>
        </form>

        <div className={styles.grid}>
          {labels.length === 0 && (
            <p className={styles.empty}>No hay etiquetas todavía.</p>
          )}
          {labels.map(label => (
            <div key={label.id} className={styles.chip}>
              <span className={styles.dot} style={{ background: label.color }} />
              <span className={styles.chipName}>{label.name}</span>
              <button className={styles.deleteBtn} onClick={() => handleDelete(label.id)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
