import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './QuickReplies.module.css';

export default function QuickReplies() {
  const [replies, setReplies] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [shortcut, setShortcut] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadReplies(); }, []);

  async function loadReplies() {
    const r = await authFetch(BASE_URL + '/api/quick-replies');
    if (r.ok) setReplies(await r.json());
  }

  function openModal() {
    setShortcut('');
    setTitle('');
    setText('');
    setError('');
    setShowModal(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!shortcut.trim() || !text.trim()) return;
    setSaving(true);
    setError('');
    try {
      const r = await authFetch(BASE_URL + '/api/quick-replies', {
        method: 'POST',
        body: { shortcut: shortcut.trim(), title: title.trim() || shortcut.trim(), text: text.trim() },
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setShowModal(false);
      await loadReplies();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    await authFetch(BASE_URL + `/api/quick-replies/${id}`, { method: 'DELETE' });
    setReplies(prev => prev.filter(r => r.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Respuestas rápidas</h1>
          <p className={styles.subtitle}>
            Escribí <code className={styles.code}>/atajo</code> en el chat para insertar una respuesta predefinida
          </p>
        </div>
        <button className={styles.newBtn} onClick={openModal}>+ Nueva respuesta</button>
      </div>

      <div className={styles.body}>
        {replies.length === 0 ? (
          <p className={styles.empty}>No hay respuestas rápidas todavía.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>ATAJO</th>
                <th className={styles.th}>TÍTULO</th>
                <th className={styles.th}>CONTENIDO</th>
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {replies.map(r => (
                <tr key={r.id} className={styles.tr}>
                  <td className={styles.td}>
                    <span className={styles.shortcutBadge}>/{r.shortcut ?? r.title}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.replyTitle}>{r.title}</span>
                  </td>
                  <td className={styles.tdContent}>
                    <span className={styles.replyText}>{r.text}</span>
                  </td>
                  <td className={styles.tdAction}>
                    <button className={styles.deleteBtn} onClick={() => handleDelete(r.id)} title="Eliminar">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Nueva respuesta rápida</span>
              <button className={styles.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <form className={styles.modalForm} onSubmit={handleCreate}>
              <div className={styles.modalRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Atajo *</label>
                  <div className={styles.shortcutField}>
                    <span className={styles.shortcutPrefix}>/</span>
                    <input
                      className={styles.shortcutInput}
                      type="text"
                      placeholder="ej: horarios"
                      value={shortcut}
                      onChange={e => setShortcut(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())}
                      maxLength={30}
                      autoFocus
                    />
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Título</label>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="ej: Horarios de atención"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={50}
                  />
                </div>
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Contenido *</label>
                <textarea
                  className={styles.textarea}
                  placeholder="Texto completo de la respuesta..."
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={5}
                />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.modalFooter}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button
                  className={styles.createBtn}
                  type="submit"
                  disabled={saving || !shortcut.trim() || !text.trim()}
                >
                  {saving ? 'Guardando…' : 'Crear respuesta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
