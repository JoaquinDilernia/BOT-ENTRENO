import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Costs.module.css';

function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}
function fmtUSD(n) {
  if (n == null) return '—';
  return '$' + n.toFixed(4).replace(/\.?0+$/, '') || '$0';
}
function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export default function Costs() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isCurrentMonth = month === currentMonth();

  useEffect(() => {
    load();
  }, [month]);

  async function load() {
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const r = await authFetch(`${BASE_URL}/api/costs?month=${month}`);
      if (r.ok) {
        setData(await r.json());
      } else {
        const body = await r.json().catch(() => ({}));
        setError(body.error || `Error ${r.status}`);
      }
    } catch (err) {
      setError('No se pudo conectar con el servidor: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  const claudeCost = data?.claude?.costUSD ?? 0;
  const metaCost   = data?.meta?.costUSD   ?? 0;
  const railMin    = data?.railway?.min     ?? 5;
  const railMax    = data?.railway?.max     ?? 10;
  const totalMin   = claudeCost + metaCost + railMin;
  const totalMax   = claudeCost + metaCost + railMax;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Costos del bot</h1>
        <div className={styles.periodNav}>
          <button className={styles.navBtn} onClick={() => setMonth(prevMonth(month))}>‹</button>
          <span className={styles.periodLabel}>{monthLabel(month)}</span>
          <button className={styles.navBtn} onClick={() => setMonth(nextMonth(month))} disabled={isCurrentMonth}>›</button>
        </div>
      </div>

      {loading && <p className={styles.loading}>Cargando...</p>}

      {!loading && error && (
        <div className={styles.errorBanner}>
          <span>⚠️ {error}</span>
          <button className={styles.retryBtn} onClick={load}>Reintentar</button>
        </div>
      )}

      {!loading && !error && data && (
        <div className={styles.grid}>

          {/* Claude */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>🤖</span>
              <span className={styles.cardTitle}>Claude (Anthropic)</span>
              <span className={styles.cardCost}>{fmtUSD(data.claude.costUSD)}</span>
            </div>
            <div className={styles.cardBody}>
              <Row label="Llamadas totales" value={data.claude.callCount} />
              <Row label="Tokens entrada"   value={fmtTokens(data.claude.inputTokens)} />
              <Row label="Tokens salida"    value={fmtTokens(data.claude.outputTokens)} />
              {data.claude.byType && Object.entries(data.claude.byType).map(([type, count]) => (
                <Row key={type} label={`  · ${TYPE_LABELS[type] ?? type}`} value={`${count} calls`} muted />
              ))}
              <div className={styles.cardNote}>
                claude-sonnet-4-6 · $3/MTok in · $15/MTok out
              </div>
            </div>
          </div>

          {/* Meta / WhatsApp */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>💬</span>
              <span className={styles.cardTitle}>WhatsApp (Meta)</span>
              <span className={styles.cardCost}>
                {data.meta.available ? fmtUSD(data.meta.costUSD) : '—'}
              </span>
            </div>
            <div className={styles.cardBody}>
              {data.meta.available ? (
                <>
                  <Row label="Conversaciones" value={data.meta.totalConversations} />
                  {data.meta.breakdown && Object.entries(data.meta.breakdown).map(([type, b]) => (
                    <Row
                      key={type}
                      label={`  · ${CONV_LABELS[type] ?? type}`}
                      value={`${b.conversations} (${fmtUSD(b.costUSD)})`}
                      muted
                    />
                  ))}
                  <div className={styles.cardNote}>Datos directos de Meta Analytics</div>
                </>
              ) : (
                <div className={styles.cardWarning}>
                  <span>No disponible</span>
                  <span className={styles.cardWarnDetail}>{data.meta.reason}</span>
                  {data.meta.reason?.includes('META_WABA_ID') && (
                    <span className={styles.cardWarnDetail}>Agregá <code>META_WABA_ID</code> en las variables de Railway.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Railway */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>🚂</span>
              <span className={styles.cardTitle}>Railway (servidor)</span>
              <span className={styles.cardCost}>${railMin}–${railMax}</span>
            </div>
            <div className={styles.cardBody}>
              <Row label="Plan" value="Hobby / Pay-as-you-go" />
              <Row label="Estimado" value={`$${railMin}–$${railMax} USD/mes`} />
              <a
                className={styles.cardLink}
                href="https://railway.app/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                Ver en Railway →
              </a>
            </div>
          </div>

          {/* Firebase */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>🔥</span>
              <span className={styles.cardTitle}>Firebase</span>
              <span className={styles.cardCost}>$0</span>
            </div>
            <div className={styles.cardBody}>
              <Row label="Plan" value="Spark (gratuito)" />
              <Row label="Firestore reads"  value="— " />
              <Row label="Firestore writes" value="—" />
              <a
                className={styles.cardLink}
                href="https://console.firebase.google.com"
                target="_blank"
                rel="noreferrer"
              >
                Ver en Firebase Console →
              </a>
            </div>
          </div>

          {/* Total */}
          <div className={`${styles.card} ${styles.cardTotal}`}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>💰</span>
              <span className={styles.cardTitle}>Total estimado</span>
              <span className={styles.cardCostTotal}>
                {fmtUSD(totalMin)} – {fmtUSD(totalMax)}
              </span>
            </div>
            <div className={styles.cardBody}>
              <Row label="Claude"    value={fmtUSD(claudeCost)} />
              <Row label="WhatsApp"  value={data.meta.available ? fmtUSD(metaCost) : 'sin datos'} />
              <Row label="Railway"   value={`$${railMin}–$${railMax}`} />
              <Row label="Firebase"  value="$0" />
              {isCurrentMonth && (
                <div className={styles.cardNote}>Mes en curso — el total seguirá creciendo</div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

function Row({ label, value, muted }) {
  return (
    <div className={`${styles.row} ${muted ? styles.rowMuted : ''}`}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </div>
  );
}

const TYPE_LABELS = {
  bot_reply: 'Respuestas del bot',
  summary:   'Resúmenes IA',
};

const CONV_LABELS = {
  BIC:     'Iniciadas por negocio',
  UIC:     'Iniciadas por usuario',
  UNKNOWN: 'Sin categoría',
};
