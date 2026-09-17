import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import styles from './Layout.module.css';

const COLLAPSED_KEY = 'bot_sidebar_collapsed';

function PageLoader() {
  return (
    <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {[160, 100, 220, 140, 180].map((w, i) => (
        <div key={i} style={{
          height: 13, width: w, borderRadius: 6,
          background: 'var(--color-border)',
          animation: 'skPulse 1.4s ease-in-out infinite',
          animationDelay: `${i * 0.08}s`,
        }} />
      ))}
      <style>{`@keyframes skPulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
    </div>
  );
}

// minRole: undefined = all, 'atencion_cliente' = not operador, 'admin' = only admin
const NAV_ITEMS = [
  { to: '/conversations', label: 'Conversaciones',  icon: IconChat },
  { to: '/customers',     label: 'Contactos',       icon: IconContacts,   minRole: 'atencion_cliente' },
  { to: '/campaigns',     label: 'Difusiones',      icon: IconMegaphone,  minRole: 'atencion_cliente' },
  { to: '/dashboard',     label: 'Dashboard',       icon: IconDashboard,  minRole: 'atencion_cliente' },
  { to: '/stats',         label: 'Estadísticas',    icon: IconChart,      minRole: 'atencion_cliente' },
  { to: '/knowledge',     label: 'Knowledge Base',  icon: IconBook,       minRole: 'atencion_cliente' },
  { to: '/areas',         label: 'Áreas',           icon: IconDepartment, minRole: 'atencion_cliente' },
  { to: '/labels',        label: 'Etiquetas',       icon: IconTag,        minRole: 'atencion_cliente' },
  { to: '/quick-replies', label: 'Resp. Rápidas',   icon: IconZap,        minRole: 'atencion_cliente' },
  { to: '/templates',     label: 'Plantillas',      icon: IconTemplate,   minRole: 'atencion_cliente' },
  { to: '/simulator',     label: 'Simulador',       icon: IconFlask,      minRole: 'atencion_cliente' },
  { to: '/config',        label: 'Configuración',   icon: IconSettings,   minRole: 'atencion_cliente' },
  { to: '/costs',         label: 'Costos',          icon: IconDollar,     minRole: 'admin' },
  { to: '/users',         label: 'Usuarios',        icon: IconUsers,      minRole: 'admin' },
];

function canAccess(role, minRole) {
  if (!minRole) return true;
  if (minRole === 'admin') return role === 'admin';
  if (minRole === 'atencion_cliente') return role === 'admin' || role === 'atencion_cliente';
  return true;
}

export default function Layout() {
  const { agent, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  function closeMenu() { setMenuOpen(false); }

  return (
    <div className={styles.shell}>
      {/* Mobile top bar */}
      <header className={styles.mobileHeader}>
        <button className={styles.hamburger} onClick={() => setMenuOpen(v => !v)} aria-label="Menú">
          <span /><span /><span />
        </button>
        <span className={styles.mobileBrand}>Entreno</span>
      </header>

      {/* Backdrop */}
      {menuOpen && <div className={styles.overlay} onClick={closeMenu} />}

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''} ${collapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.brand}>
          <div className={styles.brandLogo}>T</div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>Entreno</span>
            <span className={styles.brandSub}>Bot Dashboard</span>
          </div>
        </div>

        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(v => !v)}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {collapsed ? '»' : '«'}
        </button>

        <nav className={styles.nav}>
          {NAV_ITEMS.filter(item => canAccess(agent?.role, item.minRole)).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMenu}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <Icon className={styles.navIcon} />
              <span className={styles.navLabel}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <button className={styles.agentInfo} onClick={() => { navigate('/profile'); closeMenu(); }} title={collapsed ? (agent?.name ?? 'Agente') : undefined}>
            <div className={styles.statusDot} />
            <span className={styles.agentName}>{agent?.name ?? 'Agente'}</span>
          </button>
          <button className={styles.logoutBtn} onClick={logout} title="Salir">Salir</button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

function IconDashboard({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function IconChat({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconBook({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconTag({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function IconSettings({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconFlask({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M9 3v7l-5 9a2 2 0 0 0 1.76 2.96h10.48A2 2 0 0 0 20 19l-5-9V3" />
    </svg>
  );
}

function IconChart({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function IconZap({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconTemplate({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function IconDepartment({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconUsers({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function IconContacts({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M8 17c0-2 1.8-3 4-3s4 1 4 3" />
    </svg>
  );
}

function IconMegaphone({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11v2a2 2 0 0 0 2 2h1l2.5 5.5" />
      <path d="M6 11 18.5 5v14L6 13" />
      <path d="M18.5 8.5a3 3 0 0 1 0 7" />
    </svg>
  );
}

function IconBell({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconDollar({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
