import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Profile.module.css';

export default function Profile() {
  const { agent, updateAgent } = useAuth();

  const [name, setName] = useState(agent?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword && newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden');
      return;
    }
    if (newPassword && newPassword.length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres');
      return;
    }

    setSaving(true);
    try {
      const body = { name: name.trim() };
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }
      const r = await authFetch(BASE_URL + '/api/auth/profile', { method: 'PUT', body });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error ?? 'Error al guardar');
      }
      const data = await r.json();
      updateAgent(data.agent, data.token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mi perfil</h1>
        <p className={styles.subtitle}>Actualizá tu nombre y contraseña de acceso al dashboard.</p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Datos personales</h2>
          <div className={styles.field}>
            <label className={styles.label}>Nombre</label>
            <input
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Tu nombre"
              maxLength={40}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Usuario</label>
            <input className={`${styles.input} ${styles.inputReadonly}`} value={agent?.id ?? ''} readOnly />
            <p className={styles.hint}>El nombre de usuario no se puede cambiar.</p>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Cambiar contraseña</h2>
          <p className={styles.hint}>Dejá los campos vacíos si no querés cambiar la contraseña.</p>
          <div className={styles.field}>
            <label className={styles.label}>Contraseña actual</label>
            <input
              className={styles.input}
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Nueva contraseña</label>
            <input
              className={styles.input}
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Confirmar nueva contraseña</label>
            <input
              className={styles.input}
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
        </section>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.footer}>
          {saved && <span className={styles.savedMsg}>✓ Cambios guardados</span>}
          <button className={styles.btnPrimary} type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}
