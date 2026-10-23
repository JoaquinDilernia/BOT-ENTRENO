import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Stats.module.css';

const PERIODS = [
  { key: 'day',    label: 'Hoy' },
  { key: 'week',   label: '7 días' },
  { key: 'month',  label: '30 días' },
  { key: 'custom', label: 'Personalizado' },
];

const STATUS_META = {
  bot:          { label: 'Bot activo',        color: 'var(--color-primary)' },
  escalated:    { label: 'Escalado',          color: '#8b5cf6' },
  resolved:     { label: 'Resuelto',          color: 'var(--color-status-resolved)' },
  bot_archived: { label: 'Archivado por bot', color: '#94a3b8' },
};

const AGENT_COLORS = ['var(--color-primary)', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444'];
const DEPT_COLORS  = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];
function agentColor(idx) { return AGENT_COLORS[idx % AGENT_COLORS.length]; }
function areaColor(idx)  { return DEPT_COLORS[idx % DEPT_COLORS.length]; }

const CHANNEL_META = {
  whatsapp:  { label: 'WhatsApp',  color: '#25d366' },
  instagram: { label: 'Instagram', color: '#e1306c' },
};

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

function fmtMin(min) {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDateLong(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS[d.getDay()]} ${fmtDate(iso)}`;
}

function barLabel(dateStr, idx, total) {
  if (total <= 1) return 'Hoy';
  if (total <= 7) return WEEKDAYS[new Date(`${dateStr}T12:00:00`).getDay()];
  const step = Math.ceil(total / 8);
  return (idx % step === 0 || idx === total - 1) ? fmtDate(dateStr) : '';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function Stats() {
  const [period, setPeriod] = useState('week');
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(7));
  const [customTo, setCustomTo]     = useState(todayIso());
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const qs = period === 'custom'
    ? `period=custom&from=${customFrom}&to=${customTo}`
    : `period=${period}`;

  useEffect(() => {
    if (period === 'custom' && (!customFrom || !customTo)) return;

    setLoading(true);
    setError(null);
    authFetch(BASE_URL + `/api/stats?${qs}`)
      .then(r => {
        if (!r.ok) throw new Error(`Error ${r.status} al cargar estadísticas`);
        return r.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Estadísticas</h1>
          <p className={styles.subtitle}>Rendimiento del bot y los agentes</p>
        </div>
        <div className={styles.headerControls}>
          {period === 'custom' && (
            <div className={styles.rangeInputs}>
              <input
                type="date" className={styles.dateInput} value={customFrom}
                max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
              />
              <span className={styles.rangeSep}>–</span>
              <input
                type="date" className={styles.dateInput} value={customTo}
                min={customFrom} max={todayIso()}
                onChange={e => setCustomTo(e.target.value)}
              />
            </div>
          )}
          <div className={styles.tabs}>
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`${styles.tab} ${period === p.key ? styles.tabActive : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading ? (
        <div className={styles.loading}>Cargando estadísticas...</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : !data ? null : (
        <div className={styles.body}>

          {/* KPI Row 1: volumen */}
          <div className={styles.kpiRow4}>
            <KpiCard title="Conversaciones nuevas" value={data.conversationsStarted} sub="iniciadas en el período" />
            <KpiCard title="Conversaciones" value={data.total} sub="tocadas en el período" />
            <KpiCard
              title="Esperando agente" value={data.awaitingAgent}
              sub={data.oldestAwaitingMin != null ? `la más vieja hace ${fmtMin(data.oldestAwaitingMin)}` : 'ahora mismo, no acotado al período'}
              accent={data.awaitingAgent > 0 ? 'var(--color-status-urgent)' : undefined}
            />
            <KpiCard
              title="Urgentes" value={data.urgentCount}
              sub="abiertas y marcadas urgentes"
              accent={data.urgentCount > 0 ? 'var(--color-status-urgent)' : undefined}
            />
          </div>

          {/* KPI Row 2: resolución */}
          <div className={styles.kpiRow4}>
            <KpiCard
              title="Resueltas" value={data.resolved}
              sub={`${pct(data.resolved, data.total)}% del total`}
              accent="var(--color-status-resolved)"
            />
            <KpiCard
              title="Resueltas por el bot" value={data.resolvedByBot}
              sub="sin derivar a un agente"
              accent="var(--color-primary)"
            />
            <KpiCard
              title="Derivadas a agente" value={data.escalatedCount}
              sub={`${data.escalationRate}% del total`}
              accent="#8b5cf6"
            />
            <KpiCard
              title="Resueltas por agente" value={data.resolvedByAgent}
              sub="tras derivación"
              accent="#8b5cf6"
            />
          </div>

          {/* KPI Row 3: tasas y tiempos */}
          <div className={styles.kpiRow4}>
            <KpiCard
              title="Bot autónomo" value={`${data.botResolutionRate}%`}
              sub={data.resolved > 0 ? `${data.resolvedByBot} de ${data.resolved} resueltas, sin agente` : undefined}
              accent="var(--color-primary)"
              hint={data.resolved === 0 ? 'Sin resueltas en el período' : undefined}
            />
            <KpiCard
              title="Tasa de escalación" value={`${data.escalationRate}%`}
              sub="del total de conversaciones"
              accent={data.escalationRate > 40 ? 'var(--color-status-urgent)' : '#8b5cf6'}
            />
            <KpiCard
              title="1ª respuesta (prom.)" value={fmtMin(data.avgFirstResponseMin)}
              sub="desde escalación hasta respuesta"
              accent={
                data.avgFirstResponseMin === null ? undefined :
                data.avgFirstResponseMin > 30 ? 'var(--color-status-urgent)' :
                data.avgFirstResponseMin > 10 ? '#f59e0b' :
                'var(--color-status-resolved)'
              }
              hint={data.avgFirstResponseMin === null ? 'Sin datos suficientes' : undefined}
            />
            <KpiCard
              title="Resolución (prom.)" value={fmtMin(data.avgResolutionMin)}
              sub="desde apertura hasta cierre"
              hint={data.avgResolutionMin === null ? 'Sin datos suficientes' : undefined}
            />
          </div>

          {/* Carritos armados por el bot → ventas */}
          <BotCartStats key={`carts-${qs}`} periodQs={qs} />

          {/* Daily breakdown: chart + table */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Conversaciones nuevas por día{data.from && data.to ? ` (${fmtDate(data.from)} – ${fmtDate(data.to)})` : ''}
            </h2>
            <TrendChart data={data.dailyTrend} />
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Conversaciones nuevas</th>
                    <th>Resueltas por bot</th>
                    <th>Derivadas a agente</th>
                    <th>Resueltas por agente</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyTrend.map(d => (
                    <tr key={d.date}>
                      <td>{fmtDateLong(d.date)}</td>
                      <td>{d.started}</td>
                      <td>{d.resolvedByBot}</td>
                      <td>{d.escalated}</td>
                      <td>{d.resolvedByAgent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* By agent + by status */}
          <div className={styles.grid2}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Por agente</h2>
              <p className={styles.labelHint}>Conversaciones en las que respondió cada uno en el período (un chat puede tener respuestas del bot y de un agente).</p>
              <div className={styles.agentRows}>
                {data.byAgent.map((a, idx) => {
                  const color = agentColor(idx);
                  return (
                    <div key={a.id} className={styles.agentRow}>
                      <div className={styles.agentLeft}>
                        <span className={styles.dot} style={{ background: color }} />
                        <div>
                          <div className={styles.agentName}>{a.name}</div>
                          <div className={styles.agentSub}>{a.handled} conv respondidas · {a.messages ?? 0} msj · {a.resolved} res.</div>
                        </div>
                      </div>
                      <div className={styles.hBarTrack}>
                        <div className={styles.hBarFill} style={{ width: `${pct(a.handled, data.total)}%`, background: color }} />
                      </div>
                      <span className={styles.hBarNum}>{pct(a.handled, data.total)}%</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Por estado</h2>
              <HBars
                entries={Object.entries(data.byStatus).map(([k, v]) => ({
                  label: STATUS_META[k]?.label ?? k,
                  color: STATUS_META[k]?.color ?? 'var(--color-primary)',
                  value: v,
                }))}
                max={data.total}
              />
            </section>
          </div>

          {/* By area + by channel */}
          <div className={styles.grid2}>
            {data.byArea?.length > 0 ? (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Por área</h2>
                <div className={styles.agentRows}>
                  {data.byArea.map((d, idx) => {
                    const color = areaColor(idx);
                    return (
                      <div key={d.id} className={styles.agentRow}>
                        <div className={styles.agentLeft}>
                          <span className={styles.dot} style={{ background: color }} />
                          <div>
                            <div className={styles.agentName}>{d.name}</div>
                            <div className={styles.agentSub}>
                              {d.handled} conv · {d.resolved} res.
                              {d.avgFirstResponseMin !== null && ` · ⏱ ${fmtMin(d.avgFirstResponseMin)}`}
                            </div>
                          </div>
                        </div>
                        <div className={styles.hBarTrack}>
                          <div className={styles.hBarFill} style={{ width: `${pct(d.handled, data.total)}%`, background: color }} />
                        </div>
                        <span className={styles.hBarNum}>{pct(d.handled, data.total)}%</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Por área</h2>
                <p className={styles.empty}>Sin derivaciones en el período</p>
              </section>
            )}

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Por canal</h2>
              <HBars
                entries={Object.entries(data.byChannel).map(([k, v]) => ({
                  label: CHANNEL_META[k]?.label ?? k,
                  color: CHANNEL_META[k]?.color ?? 'var(--color-primary)',
                  value: v,
                }))}
                max={data.total}
              />
            </section>
          </div>

          {/* Labels */}
          {data.labelCounts.length > 0 && (
            <LabelStats key={qs} labels={data.labelCounts} total={data.total} periodQs={qs} />
          )}

        </div>
      )}
    </div>
  );
}

const CART_STATUS = {
  purchased: { label: 'Comprado', color: 'var(--color-status-resolved)' },
  pending:   { label: 'Pendiente', color: '#f59e0b' },
  expired:   { label: 'Sin compra', color: '#94a3b8' },
};

function fmtMoney(n) {
  return '$' + Math.round(n ?? 0).toLocaleString('es-AR');
}

// Carritos que armó el bot (tool armar_carrito) y cuántos terminaron en una
// venta pagada en TiendaNube — atribución por teléfono + producto dentro de
// la ventana (ver server/src/services/cartAttribution.js).
function BotCartStats({ periodQs }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    authFetch(BASE_URL + `/api/stats/carts?${periodQs}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(setData)
      .catch(err => setError(err.message));
  }, [periodQs]);

  if (error) return <section className={styles.section}><h2 className={styles.sectionTitle}>Carritos del bot</h2><p className={styles.empty}>No se pudieron cargar los carritos ({error}).</p></section>;
  if (!data) return null;

  const shown = showAll ? data.carts : data.carts.slice(0, 10);
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Carritos del bot</h2>
      <p className={styles.labelHint}>
        Carritos que armó el bot en el período. Cuenta como comprado si ese mismo número de WhatsApp pagó un pedido con alguno de esos productos dentro de los {data.windowDays} días.
      </p>
      <div className={styles.kpiRow4}>
        <KpiCard title="Carritos creados" value={data.created} sub={data.created ? `${fmtMoney(data.cartsTotal)} en carritos` : undefined} />
        <KpiCard title="Comprados" value={data.purchased} sub={data.pending ? `${data.pending} todavía pueden comprar` : undefined} accent="var(--color-status-resolved)" />
        <KpiCard title="Conversión" value={`${data.conversionPct}%`} sub="carritos que terminaron en venta" />
        <KpiCard title="Vendido" value={fmtMoney(data.salesTotal)} sub="total de esos pedidos" />
      </div>
      {data.carts.length === 0 ? (
        <p className={styles.empty}>El bot no armó carritos en este período.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Total carrito</th><th>Estado</th><th>Pedido</th></tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/conversations?open=${encodeURIComponent(c.contactId)}`)}>
                  <td>{fmtActivity(c.createdAt)}</td>
                  <td>{c.contactId}</td>
                  <td>{c.items.map(i => `${i.quantity} x ${i.name}`).join(', ')}</td>
                  <td>{fmtMoney(c.total)}</td>
                  <td style={{ color: CART_STATUS[c.status]?.color, fontWeight: 600 }}>{CART_STATUS[c.status]?.label ?? c.status}</td>
                  <td>{c.orderNumber ? `#${c.orderNumber} · ${fmtMoney(c.orderTotal)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.carts.length > 10 && (
            <button type="button" className={styles.labelMore} onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Ver menos' : `Ver los ${data.carts.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function KpiCard({ title, value, sub, accent, hint }) {
  return (
    <div className={styles.kpiCard}>
      <span className={styles.kpiTitle}>{title}</span>
      <span className={styles.kpiValue} style={accent ? { color: accent } : undefined}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
      {hint && <span className={styles.kpiHint}>{hint}</span>}
    </div>
  );
}

const CHART_H = 80;

function TrendChart({ data }) {
  const max = Math.max(...data.map(d => d.started), 1);
  return (
    <div className={styles.trendChart}>
      {data.map((d, i) => {
        const h = Math.round((d.started / max) * CHART_H);
        return (
          <div key={d.date} className={styles.trendCol}>
            <span className={styles.trendCount}>{d.started > 0 ? d.started : ''}</span>
            <div className={styles.trendBarWrap}>
              <div
                className={styles.trendBar}
                style={{ height: `${Math.max(h, d.started > 0 ? 3 : 0)}px` }}
              />
            </div>
            <span className={styles.trendLabel}>{barLabel(d.date, i, data.length)}</span>
          </div>
        );
      })}
    </div>
  );
}

const LABELS_COLLAPSED = 10;

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function fmtActivity(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function LabelStats({ labels, total, periodQs }) {
  const navigate = useNavigate();
  const [query, setQuery]       = useState('');
  const [showAll, setShowAll]   = useState(false);
  const [openLabel, setOpenLabel] = useState(null);
  const [convs, setConvs]       = useState(null); // null = cargando
  const [convsError, setConvsError] = useState(null);

  function toggleLabel(name) {
    if (openLabel === name) { setOpenLabel(null); return; }
    setOpenLabel(name);
    setConvs(null);
    setConvsError(null);
    authFetch(BASE_URL + `/api/stats/labels/conversations?${periodQs}&label=${encodeURIComponent(name)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Error ${r.status} al cargar conversaciones`);
        return r.json();
      })
      .then(d => setConvs(d.conversations))
      .catch(err => setConvsError(err.message));
  }

  const q = normalize(query.trim());
  const matches = q ? labels.filter(l => normalize(l.name).includes(q)) : labels;
  const visible = q || showAll ? matches : matches.slice(0, LABELS_COLLAPSED);
  const max = labels[0].count;

  return (
    <section className={styles.section}>
      <div className={styles.labelHeader}>
        <h2 className={styles.sectionTitle}>Etiquetas</h2>
        <input
          type="search"
          className={styles.labelSearch}
          placeholder={`Buscar entre ${labels.length} etiquetas…`}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      <p className={styles.labelHint}>
        Conversaciones con actividad en el período. Tocá una etiqueta para ver sus conversaciones.
      </p>

      {visible.length === 0 ? (
        <p className={styles.empty}>Ninguna etiqueta coincide con "{query}" en este período.</p>
      ) : (
        <div className={styles.labelList}>
          {visible.map(l => {
            const isOpen = openLabel === l.name;
            return (
              <div key={l.name}>
                <button
                  type="button"
                  className={`${styles.labelRow} ${isOpen ? styles.labelRowOpen : ''}`}
                  onClick={() => toggleLabel(l.name)}
                  aria-expanded={isOpen}
                >
                  <span className={styles.labelName}>{l.name}</span>
                  <span className={styles.labelTrack}>
                    <span className={styles.hBarFill} style={{ width: `${pct(l.count, max)}%`, background: 'var(--color-primary)' }} />
                  </span>
                  <span className={styles.labelCount}>{l.count}</span>
                  <span className={styles.labelPct}>{pct(l.count, total)}%</span>
                  <span className={styles.labelChevron}>{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && convsError && <p className={styles.labelConvsMsg}>{convsError}</p>}
                {isOpen && !convsError && !convs && <p className={styles.labelConvsMsg}>Cargando conversaciones…</p>}
                {isOpen && convs && (
                  <ul className={styles.labelConvs}>
                    {convs.map(c => (
                      <li key={c.id} className={styles.labelConv}>
                        <span className={styles.labelConvName}>{c.contactName || c.id}</span>
                        <span className={styles.labelConvMeta}>{c.contactName ? c.id : ''}</span>
                        <span className={styles.labelConvMeta}>{CHANNEL_META[c.channel]?.label ?? c.channel}</span>
                        <span className={styles.labelConvMeta}>{STATUS_META[c.status]?.label ?? c.status}</span>
                        <span className={styles.labelConvMeta}>{fmtActivity(c.lastActivityAt)}</span>
                        <button
                          type="button"
                          className={styles.labelConvOpen}
                          onClick={() => navigate(`/conversations?open=${encodeURIComponent(c.id)}`)}
                        >
                          Abrir
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!q && matches.length > LABELS_COLLAPSED && (
        <button type="button" className={styles.labelMore} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Ver menos' : `Ver todas (${matches.length})`}
        </button>
      )}
    </section>
  );
}

function HBars({ entries, max }) {
  return (
    <div className={styles.hBars}>
      {entries.map(e => (
        <div key={e.label} className={styles.hBarRow}>
          <span className={styles.hBarLabel}>{e.label}</span>
          <div className={styles.hBarTrack}>
            <div className={styles.hBarFill} style={{ width: `${pct(e.value, max)}%`, background: e.color }} />
          </div>
          <span className={styles.hBarNum}>{e.value}</span>
        </div>
      ))}
    </div>
  );
}
