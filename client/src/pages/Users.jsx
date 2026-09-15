import { useEffect, useState, useCallback } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import styles from './Users.module.css';

const ROLES = [
  { value: 'operador', label: 'Operador', desc: 'Ve las conversaciones de su área asignada' },
  { value: 'atencion_cliente', label: 'Atención al cliente', desc: 'Acceso completo excepto gestión de usuarios' },
  { value: 'admin', label: 'Administrador', desc: 'Acceso total incluida gestión de usuarios' },
];

const ROLE_LABEL = { admin: 'Admin', atencion_cliente: 'Atención al cliente', operador: 'Operador' };
const ROLE_COLOR = { admin: styles.roleAdmin, atencion_cliente: styles.roleAtencion, operador: styles.roleOperador };

const DEFAULT_FORM = { name: '', email: '', password: '', role: 'operador', areaIds: [] };

export default function Users() {
  const { agent: me } = useAuth();
  const [users, setUsers]           = useState([]);
  const [areas, setAreas]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [form, setForm]             = useState(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, areasRes] = await Promise.all([
        authFetch(BASE_URL + '/api/auth/users'),
        authFetch(BASE_URL + '/api/areas'),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json());
      if (areasRes.ok) setAreas((await areasRes.json()).areas ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ mode: 'create', data: { ...DEFAULT_FORM } });
    setError('');
  }

  function openEdit(user) {
    setForm({ mode: 'edit', data: { id: user.id, name: user.name, email: user.email, role: user.role, areaIds: user.areaIds ?? [], password: '' } });
    setError('');
  }

  function cancel() { setForm(null); setError(''); }

  function setField(key, val) {
    setForm(p => ({ ...p, data: { ...p.data, [key]: val } }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { name, email, password, role, areaIds } = form.data;

      if (form.mode === 'create') {
        if (!name || !email || !password) throw new Error('Nombre, email y contraseña son requeridos');
        const res = await authFetch(BASE_URL + '/api/auth/users', {
          method: 'POST',
          body: { name, email, password, role, areaIds },
        });
        if (!res.ok) throw new Error((await res.json()).error);
      } else {
        const { id } = form.data;
        const res = await authFetch(BASE_URL + `/api/auth/users/${id}`, {
          method: 'PUT',
          body: { name, role, areaIds },
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

  async function handleDelete(user) {
    if (!confirm(`¿Eliminás al usuario ${user.name}? Esta acción no se puede deshacer.`)) return;
    await authFetch(BASE_URL + `/api/auth/users/${user.id}`, { method: 'DELETE' });
    setUsers(prev => prev.filter(u => u.id !== user.id));
  }

  const areaName = id => areas.find(a => a.id === id)?.name ?? id;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Usuarios</h1>
          <p className={styles.subtitle}>Gestioná quién tiene acceso al panel y qué puede hacer.</p>
        </div>
        {!form && (
          <button className={styles.btnPrimary} onClick={openCreate}>+ Nuevo usuario</button>
        )}
      </header>

      <div className={styles.body}>
        {error && <div className={styles.errorBanner}>{error}</div>}

        {form && (
          <form className={styles.form} onSubmit={handleSubmit}>
            <h2 className={styles.formTitle}>
              {form.mode === 'create' ? 'Nuevo usuario' : `Editar: ${form.data.name}`}
            </h2>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre completo</label>
                <input
                  className={styles.input}
                  value={form.data.name}
                  onChange={e => setField('name', e.target.value)}
                  placeholder="Ej: María García"
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input
                  className={styles.input}
                  type="email"
                  value={form.data.email}
                  onChange={e => setField('email', e.target.value)}
                  placeholder="usuario@empresa.com"
                  required
                  disabled={form.mode === 'edit'}
                />
              </div>
            </div>

            {form.mode === 'create' && (
              <div className={styles.field}>
                <label className={styles.label}>Contraseña inicial</label>
                <input
                  className={styles.input}
                  type="password"
                  value={form.data.password}
                  onChange={e => setField('password', e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  minLength={8}
                />
                <p className={styles.hint}>El usuario puede cambiarla desde su perfil.</p>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Rol</label>
              <div className={styles.roleCards}>
                {ROLES.map(r => (
                  <label
                    key={r.value}
                    className={`${styles.roleCard} ${form.data.role === r.value ? styles.roleCardActive : ''}`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r.value}
                      checked={form.data.role === r.value}
                      onChange={() => setField('role', r.value)}
                      className={styles.srOnly}
                    />
                    <span className={styles.roleCardName}>{r.label}</span>
                    <span className={styles.roleCardDesc}>{r.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Áreas asignadas</label>
              <div className={styles.checkboxGroup}>
                {areas.map(a => (
                  <label key={a.id} className={styles.checkboxItem}>
                    <input
                      type="checkbox"
                      checked={form.data.areaIds.includes(a.id)}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...form.data.areaIds, a.id]
                          : form.data.areaIds.filter(id => id !== a.id);
                        setField('areaIds', next);
                      }}
                    />
                    {a.name}
                  </label>
                ))}
                {areas.length === 0 && <p className={styles.hint}>No hay áreas configuradas todavía.</p>}
              </div>
              <p className={styles.hint}>
                {form.data.role === 'operador'
                  ? 'El operador verá solo las conversaciones escaladas a esta área.'
                  : '"Mis casos" mostrará las conversaciones asignadas a esta área.'}
              </p>
            </div>

            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={cancel}>Cancelar</button>
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? 'Guardando...' : form.mode === 'create' ? 'Crear usuario' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <UsersSkeleton />
        ) : users.length === 0 ? (
          <p className={styles.empty}>No hay usuarios creados.</p>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span>Nombre</span>
              <span>Email</span>
              <span>Rol / Área</span>
              <span></span>
            </div>
            {users.map(user => (
              <div key={user.id} className={`${styles.tableRow} ${user.id === me?.id ? styles.rowMe : ''}`}>
                <div className={styles.userInfo}>
                  <div className={styles.avatar}>{(user.name?.[0] ?? '?').toUpperCase()}</div>
                  <span className={styles.userName}>
                    {user.name}
                    {user.id === me?.id && <span className={styles.youBadge}>vos</span>}
                  </span>
                </div>
                <span className={styles.userEmail}>{user.email}</span>
                <div className={styles.roleCell}>
                  <span className={`${styles.roleBadge} ${ROLE_COLOR[user.role] ?? ''}`}>
                    {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                  {(user.areaIds ?? []).map(id => (
                    <span key={id} className={styles.deptTag}>{areaName(id)}</span>
                  ))}
                </div>
                <div className={styles.rowActions}>
                  <button className={styles.actionBtn} onClick={() => openEdit(user)}>Editar</button>
                  {user.id !== me?.id && (
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => handleDelete(user)}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={styles.rolesGuide}>
          <h3 className={styles.guideTitle}>Permisos por rol</h3>
          <div className={styles.guideGrid}>
            <div className={styles.guideRow}>
              <span className={`${styles.roleBadge} ${styles.roleOperador}`}>Operador</span>
              <span className={styles.guideDesc}>Ve todas las conversaciones escaladas a su área. Sin estadísticas, configuración ni base de conocimiento.</span>
            </div>
            <div className={styles.guideRow}>
              <span className={`${styles.roleBadge} ${styles.roleAtencion}`}>Atención al cliente</span>
              <span className={styles.guideDesc}>Acceso completo al panel: todas las conversaciones, estadísticas, KB, configuración del bot y áreas. No puede gestionar usuarios.</span>
            </div>
            <div className={styles.guideRow}>
              <span className={`${styles.roleBadge} ${styles.roleAdmin}`}>Administrador</span>
              <span className={styles.guideDesc}>Todo lo anterior más gestión de usuarios y acceso a costos.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersSkeleton() {
  return (
    <div className={styles.skeleton}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.skRow} style={{ animationDelay: `${i * 80}ms` }}>
          <div className={styles.skCircle} />
          <div className={styles.skLine} style={{ width: 140 }} />
          <div className={styles.skLine} style={{ width: 200 }} />
          <div className={styles.skLine} style={{ width: 80 }} />
        </div>
      ))}
    </div>
  );
}
