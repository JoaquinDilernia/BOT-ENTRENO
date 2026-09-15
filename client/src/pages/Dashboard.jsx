import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, BASE_URL } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import styles from './Dashboard.module.css';

function fmtWaitTime(min) {
  if (min == null) return null;
  if (min < 60) return `${Math.round(min)}m`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function timeAgo(val) {
  if (!val) return '';
  const d = val?.seconds ? new Date(val.seconds * 1000) : new Date(val);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const STATUS_LABEL = {
  bot: 'Bot',
  escalated: 'Derivada',
  resolved: 'Resuelta',
  urgent: 'Urgente',
  bot_archived: 'Archivada',
};

const STATUS_STYLE = {
  bot: styles.statusBot,
  escalated: styles.statusEscalated,
  resolved: styles.statusResolved,
  urgent: styles.statusUrgent,
};

export default function Dashboard() {
  const { agent } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, convsRes] = await Promise.all([
        authFetch(BASE_URL + '/api/stats?period=day'),
        authFetch(BASE_URL + '/api/conversations'),
      ]);
      const [statsData, convsData] = await Promise.all([statsRes.json(), convsRes.json()]);
      setStats(statsData);
      setRecent((convsData.conversations ?? []).slice(0, 6));
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{greeting()}, {agent?.name?.split(' ')[0]}</h1>
          <p className={styles.subtitle}>Actividad de hoy</p>
        </div>
        <button className={styles.refreshBtn} onClick={load} title="Actualizar">
          <IconRefresh />
        </button>
      </header>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className={styles.statsGrid}>
            <StatCard icon={<IconMessages />} label="Conversaciones hoy" value={stats?.total ?? 0} accent="primary" />
            <StatCard
              icon={<IconCheck />} label="Resueltas hoy" value={stats?.resolved ?? 0} accent="resolved"
              sub={stats?.resolved ? `${stats.resolvedByBot} bot · ${stats.resolvedByAgent} agente` : undefined}
            />
            <StatCard
              icon={<IconArrow />} label="Esperando agente" value={stats?.awaitingAgent ?? 0}
              accent={stats?.awaitingAgent > 0 ? 'urgent' : 'escalated'}
              sub={stats?.oldestAwaitingMin != null ? `la más vieja espera hace ${fmtWaitTime(stats.oldestAwaitingMin)}` : undefined}
            />
            <StatCard icon={<IconClock />}    label="Bot activo" value={stats?.byStatus?.bot ?? 0} accent="bot" />
            <StatCard icon={<IconWpp />}      label="WhatsApp" value={stats?.byChannel?.whatsapp ?? 0} accent="whatsapp" />
            <StatCard icon={<IconIg />}       label="Instagram" value={stats?.byChannel?.instagram ?? 0} accent="instagram" />
          </div>

          {stats?.resolved > 0 ? (
            <div className={styles.rateBar}>
              <span className={styles.rateLabel}>
                De las {stats.resolved} resueltas hoy, el bot cerró {stats.resolvedByBot} sin ayuda de un agente
              </span>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${stats.botResolutionRate}%` }} />
              </div>
              <span className={styles.rateValue}>{stats.botResolutionRate}%</span>
            </div>
          ) : (
            <div className={styles.rateBar}>
              <span className={styles.rateLabel}>Todavía no se resolvió ninguna conversación hoy</span>
            </div>
          )}

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Últimas conversaciones</h2>
              <button className={styles.linkBtn} onClick={() => navigate('/conversations')}>
                Ver todas →
              </button>
            </div>
            {recent.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>💬</span>
                <p>Sin conversaciones todavía. Cuando llegue el primer mensaje aparecerá acá.</p>
              </div>
            ) : (
              <div className={styles.convList}>
                {recent.map(c => (
                  <ConvRow key={c.id} conv={c} onClick={() => navigate('/conversations')} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, accent, sub }) {
  return (
    <div className={`${styles.statCard} ${styles[`accent_${accent}`]}`}>
      <div className={styles.statIcon}>{icon}</div>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

function ConvRow({ conv, onClick }) {
  const name = conv.contactName || conv.contactId;
  const channel = conv.channel === 'whatsapp' ? 'WPP' : 'IG';
  const channelClass = conv.channel === 'whatsapp' ? styles.badgeWpp : styles.badgeIg;
  const statusClass = STATUS_STYLE[conv.status] ?? styles.statusBot;

  return (
    <button className={styles.convRow} onClick={onClick}>
      <div className={styles.convAvatar}>{(name?.[0] ?? '?').toUpperCase()}</div>
      <div className={styles.convBody}>
        <div className={styles.convTop}>
          <span className={styles.convName}>{name}</span>
          <span className={styles.convTime}>{timeAgo(conv.lastMessageAt)}</span>
        </div>
        <p className={styles.convMsg}>{conv.lastMessage || '—'}</p>
      </div>
      <div className={styles.convBadges}>
        <span className={`${styles.badge} ${channelClass}`}>{channel}</span>
        <span className={`${styles.badge} ${statusClass}`}>{STATUS_LABEL[conv.status] ?? conv.status}</span>
      </div>
    </button>
  );
}

function DashboardSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.skeletonCard} style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className={styles.skeletonList}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skeletonRow} style={{ animationDelay: `${i * 60}ms` }}>
            <div className={styles.skeletonCircle} />
            <div className={styles.skeletonLines}>
              <div className={styles.skeletonLine} style={{ width: '40%' }} />
              <div className={styles.skeletonLine} style={{ width: '70%', opacity: .6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconRefresh() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
}
function IconMessages() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}
function IconClock() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
function IconArrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>;
}
function IconCheck() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
}
function IconWpp() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;
}
function IconIg() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>;
}
