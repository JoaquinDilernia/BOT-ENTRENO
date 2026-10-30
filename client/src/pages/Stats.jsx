import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, BASE_URL } from '../lib/api';
import { useBrand } from '../contexts/BrandContext';
import BotFace from '../components/ui/BotFace';
import Skeleton from '../components/ui/Skeleton';
import { useCountUp } from '../hooks/useCountUp';
import { useFirstLoad } from '../hooks/useFirstLoad';
import { avatarColor, initials } from '../lib/conversationView';
import { delta, stackedDays } from '../lib/statsView';
import styles from './Stats.module.css';

const PERIODS = [
  { key: 'day',    label: 'Hoy' },
  { key: 'week',   label: '7 días' },
  { key: 'month',  label: '30 días' },
  { key: 'custom', label: 'Elegir fechas' },
];

const STATUS_META = {
  bot:          { label: 'Bot activo',        color: 'var(--brand)' },
  escalated:    { label: 'Escalado',          color: '#8b5cf6' },
  resolved:     { label: 'Resuelto',          color: 'var(--color-status-resolved)' },
  bot_archived: { label: 'Archivado por bot', color: '#94a3b8' },
};

const CHANNEL_META = {
  whatsapp:  { label: 'WhatsApp',  color: '#25d366' },
  instagram: { label: 'Instagram', color: '#dd2a7b' },
};

const LABEL_TONES = [
  { bg: 'var(--brand-soft)', fg: 'var(--brand-ink)' },
  { bg: '#fff4d6', fg: '#9a6a00' },
  { bg: '#ede9fe', fg: '#6d28d9' },
  { bg: '#fdecea', fg: '#c0392b' },
  { bg: '#f0f2f5', fg: '#54656f' },
];

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

function fmtMoney(n) {
  return '$' + Math.round(n ?? 0).toLocaleString('es-AR');
}

/** Minutos (pueden ser decimales) -> "8s", "14m", "1h 5m". */
function fmtMin(min) {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  if (min < 1) return `${Math.round(min * 60)}s`;
  const total = Math.round(min);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Pasa de 0 a 1 un instante después de montar (para transiciones CSS de entrada). */
function useGrown(animate) {
  const [k, setK] = useState(animate ? 0 : 1);
  useEffect(() => {
    if (k === 1) return undefined;
    const t = setTimeout(() => setK(1), 40);
    return () => clearTimeout(t);
  }, [k]);
  return k;
}

/** Fundido corto cuando cambia `k` (cambio de período); no se dispara en el montaje. */
function Swap({ k, children }) {
  const prev = useRef(k);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prev.current !== k) { prev.current = k; setTick(t => t + 1); }
  }, [k]);
  return <span key={tick} className={tick ? styles.swap : undefined}>{children}</span>;
}

function Num({ value, animate, suffix = '' }) {
  const v = useCountUp(Number(value) || 0, { animate });
  return <Swap k={value}>{v}{suffix}</Swap>;
}

function Delta({ d }) {
  if (!d) return <span className={`${styles.delta} ${styles.deltaNone}`}>—</span>;
  return <span className={`${styles.delta} ${d.good ? '' : styles.deltaBad}`}>{d.text}</span>;
}

export default function Stats() {
  const { botName } = useBrand();
  const [period, setPeriod] = useState('week');
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(7));
  const [customTo, setCustomTo]     = useState(todayIso());
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true); // solo la carga inicial: cambiar de período no vuelve al esqueleto
  const [error, setError]   = useState(null);

  const firstLoad = useFirstLoad(loading);

  const qs = period === 'custom'
    ? `period=custom&from=${customFrom}&to=${customTo}`
    : `period=${period}`;

  useEffect(() => {
    if (period === 'custom' && (!customFrom || !customTo)) return undefined;

    let cancelled = false;
    setError(null);
    authFetch(BASE_URL + `/api/stats?${qs}`)
      .then(r => {
        if (!r.ok) throw new Error(`Error ${r.status} al cargar estadísticas`);
        return r.json();
      })
      .then(d => { if (!cancelled) setData(d); })
      // Sin datos viejos al lado del error: los números serían de otro período.
      .catch(err => { if (!cancelled) { setData(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${styles.page} ${firstLoad ? 'is-entering' : ''}`}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Estadísticas</h1>
            <p className={styles.subtitle}>Rendimiento de {botName} y del equipo</p>
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
            <div className={styles.chips} role="tablist" aria-label="Período">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={period === p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`${styles.chip} ${period === p.key ? styles.chipOn : ''}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <StatsSkeleton />
        ) : !data ? null : (
          <StatsBody data={data} botName={botName} animate={firstLoad} qs={qs} />
        )}
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className={styles.body} aria-busy="true">
      <div className={styles.top}>
        <Skeleton h={190} radius={16} />
        <div className={styles.tiles}>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={74} radius={12} />)}
        </div>
      </div>
      <div className={styles.row3}>
        <Skeleton h={220} radius={14} />
        <Skeleton h={220} radius={14} />
        <Skeleton h={220} radius={14} />
      </div>
    </div>
  );
}

function StatsBody({ data, botName, animate, qs }) {
  const prev = data.previous ?? {};
  const rate = data.botResolutionRate ?? 0;
  const total = data.total ?? 0;
  const hours = data.byBusinessHours ?? { inside: 0, outside: 0 };
  const waitSub = data.oldestAwaitingMin != null ? `la más vieja hace ${fmtMin(data.oldestAwaitingMin)}` : null;

  const tiles = [
    { key: 'conv',  label: 'Conversaciones',      value: total,                      d: delta(total, prev.total, { kind: 'pct', goodWhen: 'up' }), sub: 'tocadas en el período' },
    { key: 'new',   label: 'Nuevos contactos',    value: data.conversationsStarted,  d: delta(data.conversationsStarted, prev.conversationsStarted, { kind: 'pct', goodWhen: 'up' }), sub: 'iniciadas en el período' },
    { key: 'esc',   label: 'Derivadas al equipo', value: data.escalatedCount,        d: delta(data.escalatedCount, prev.escalatedCount, { kind: 'pct', goodWhen: 'down' }) },
    { key: 'urg',   label: 'Urgentes',            value: data.urgentCount,           d: null, sub: 'abiertas y marcadas urgentes', color: data.urgentCount > 0 ? 'var(--color-status-urgent)' : undefined },
    { key: 'first', label: '1ª respuesta (prom.)', text: fmtMin(data.avgFirstResponseMin), d: delta(data.avgFirstResponseMin, prev.avgFirstResponseMin, { kind: 'min', goodWhen: 'down' }), sub: data.avgFirstResponseMin == null ? 'Sin datos suficientes' : undefined },
    { key: 'res',   label: 'Resolución (prom.)',  text: fmtMin(data.avgResolutionMin), d: delta(data.avgResolutionMin, prev.avgResolutionMin, { kind: 'min', goodWhen: 'down' }), sub: data.avgResolutionMin == null ? 'Sin datos suficientes' : undefined },
    { key: 'wait',  label: 'Esperando ahora',     value: data.awaitingAgent,         d: undefined, sub: waitSub ?? 'ahora mismo, no acotado al período', color: data.awaitingAgent > 0 ? 'var(--color-status-urgent)' : undefined },
    { key: 'rate',  label: 'Tasa de derivación',  value: data.escalationRate, suffix: '%', d: delta(data.escalationRate, prev.escalationRate, { kind: 'abs', goodWhen: 'down' }), sub: 'del total de conversaciones' },
  ];

  return (
    <div className={styles.body}>
      <div className={styles.top}>
        <Hero data={data} botName={botName} rate={rate} animate={animate} />
        <div className={styles.tiles}>
          {tiles.map((t, i) => (
            <div key={t.key} className={`${styles.tile} anim-rise`} style={{ '--d': `${80 + i * 50}ms` }}>
              <small>{t.label}</small>
              <div className={styles.tileRow}>
                <strong style={t.color ? { color: t.color } : undefined}>
                  {t.text !== undefined ? <Swap k={t.text}>{t.text}</Swap> : <Num value={t.value ?? 0} animate={animate} suffix={t.suffix} />}
                </strong>
                {t.d !== undefined && <Delta d={t.d} />}
              </div>
              {t.sub && <span className={styles.tileSub}>{t.sub}</span>}
            </div>
          ))}
        </div>
      </div>

      <section className={`${styles.card} ${styles.statusCard} anim-rise`} style={{ '--d': '300ms' }}>
        <h2 className={styles.cardTitle}>Por estado</h2>
        <div className={styles.statusChips}>
          {Object.entries(data.byStatus ?? {}).map(([k, v]) => (
            <span key={k} className={styles.statusChip} title={`${pct(v, total)}% del total`}>
              <i style={{ background: STATUS_META[k]?.color ?? 'var(--brand)' }} />
              {STATUS_META[k]?.label ?? k}
              <b>{v}</b>
            </span>
          ))}
        </div>
      </section>

      <div className={styles.row2}>
        <DaysCard data={data} botName={botName} animate={animate} />
        <DayNight hours={hours} botName={botName} />
      </div>

      <div className={styles.row3}>
        <ChannelCard byChannel={data.byChannel ?? {}} total={total} animate={animate} />
        <AreaCard byArea={data.byArea ?? []} total={total} />
        <AgentCard byAgent={data.byAgent ?? []} total={total} botName={botName} />
      </div>

      {data.byReason?.length > 0 && <ReasonStats key={`why-${qs}`} byReason={data.byReason} botName={botName} />}

      {data.labelCounts?.length > 0 && (
        <LabelStats key={qs} labels={data.labelCounts} total={total} periodQs={qs} />
      )}

      <BotCartStats key={`carts-${qs}`} periodQs={qs} />
    </div>
  );
}

const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R;

function Hero({ data, botName, rate, animate }) {
  const k = useGrown(animate);
  const resolved = data.resolved ?? 0;
  return (
    <div className={`${styles.hero} anim-rise`}>
      <div className={styles.heroFrom}><BotFace size={22} tone="light" />Resolvió {botName} solo</div>
      <div className={styles.ringWrap}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
          <circle cx="48" cy="48" r={RING_R} fill="none" stroke="#ffffff22" strokeWidth="10" />
          <circle
            className={styles.ring}
            cx="48" cy="48" r={RING_R} fill="none" style={{ stroke: 'color-mix(in srgb, var(--brand) 45%, white)' }} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - (Math.min(rate, 100) / 100) * k)}
            transform="rotate(-90 48 48)"
          />
        </svg>
        <div>
          <div className={styles.heroPct}><Num value={rate} animate={animate} suffix="%" /></div>
          <p className={styles.heroText}>
            {resolved > 0
              ? <>{data.resolvedByBot} de {resolved} conversaciones resueltas<br />sin que intervenga nadie</>
              : 'Sin conversaciones resueltas en el período'}
          </p>
        </div>
      </div>
      <div className={styles.heroSplit}>
        <span style={{ '--c': 'color-mix(in srgb, var(--brand) 45%, white)' }}>{botName} {data.resolvedByBot}</span>
        <span style={{ '--c': '#ffffff66' }}>Equipo {data.resolvedByAgent}</span>
      </div>
    </div>
  );
}

function barLabel(dateStr, idx, count, fallback) {
  if (count <= 7) return fallback;
  const step = Math.ceil(count / 8);
  return (idx % step === 0 || idx === count - 1) ? fmtDate(dateStr) : '';
}

const CHART_H = 110;

function DaysCard({ data, botName, animate }) {
  const trend = data.dailyTrend ?? [];
  const days = stackedDays(trend);
  const max = Math.max(...days.map(d => d.bot + d.team), 1);
  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '350ms' }}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Conversaciones por día</h2>
        <small>{botName} vs equipo{data.from && data.to ? ` · ${fmtDate(data.from)} – ${fmtDate(data.to)}` : ''}</small>
      </div>
      <div className={styles.chart} style={{ height: CHART_H + 20 }}>
        {days.map((d, i) => {
          const sum = d.bot + d.team;
          return (
            <div key={trend[i].date} className={styles.col} title={`${fmtDateLong(trend[i].date)}: ${d.bot} ${botName}, ${d.team} equipo`}>
              <span className={styles.colNum}>{sum > 0 ? sum : ''}</span>
              <div className={styles.stackWrap} style={{ height: CHART_H }}>
                <div
                  className={`${styles.stack} ${animate ? 'anim-grow-y' : ''}`}
                  style={{ height: `${(sum / max) * 100}%`, '--d': `${500 + Math.min(i * 25, 400)}ms` }}
                >
                  {d.team > 0 && <i className={styles.segTeam} style={{ flex: d.team }} />}
                  {d.bot > 0 && <i className={styles.segBot} style={{ flex: d.bot }} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.days}>
        {days.map((d, i) => (
          <span key={trend[i].date}>{barLabel(trend[i].date, i, days.length, d.label)}</span>
        ))}
      </div>
      <div className={styles.legend}>
        <span style={{ '--c': 'var(--brand)' }}>Resolvió {botName}</span>
        <span style={{ '--c': 'var(--brand-soft)' }}>Atendió el equipo</span>
      </div>
      <details className={styles.details}>
        <summary>Ver detalle por día</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Día</th>
                <th>Nuevas</th>
                <th>Resueltas por bot</th>
                <th>Derivadas</th>
                <th>Resueltas por agente</th>
              </tr>
            </thead>
            <tbody>
              {trend.map(d => (
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
      </details>
    </section>
  );
}

function DayNight({ hours, botName }) {
  const inside = hours.inside ?? 0;
  const outside = hours.outside ?? 0;
  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '420ms' }}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Día vs noche</h2>
        <small>según el horario de atención</small>
      </div>
      <div className={styles.dn}>
        <div className={styles.day}>
          <span className={styles.sun} />
          <strong><Swap k={inside}>{inside}</Swap></strong>
          <small>en horario de atención</small>
        </div>
        <div className={styles.night}>
          <span className={styles.moon} />
          <span className={styles.star} style={{ left: 14, top: 16 }} />
          <span className={styles.star} style={{ left: 40, top: 30, animationDelay: '.8s' }} />
          <span className={styles.star} style={{ left: 24, top: 46, animationDelay: '1.4s' }} />
          <strong><Swap k={outside}>{outside}</Swap></strong>
          <small>fuera de horario: las cubrió {botName}</small>
        </div>
      </div>
    </section>
  );
}

const DONUT_R = 34;
const DONUT_C = 2 * Math.PI * DONUT_R;

function ChannelCard({ byChannel, total, animate }) {
  const k = useGrown(animate);
  const entries = Object.entries(byChannel).map(([key, v]) => ({
    key, value: v,
    label: CHANNEL_META[key]?.label ?? key,
    color: CHANNEL_META[key]?.color ?? 'var(--brand)',
  }));
  const sum = entries.reduce((s, e) => s + e.value, 0);
  let acc = 0;
  const segs = entries.map(e => {
    const len = sum > 0 ? (e.value / sum) * DONUT_C : 0;
    const seg = { ...e, len, start: acc };
    acc += len;
    return seg;
  });
  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '470ms' }}>
      <div className={styles.cardHead}><h2 className={styles.cardTitle}>Por canal</h2></div>
      <div className={styles.donut}>
        <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
          <circle cx="46" cy="46" r={DONUT_R} fill="none" stroke="var(--color-surface-alt)" strokeWidth="14" />
          <g transform="rotate(-90 46 46)">
            {segs.filter(s => s.len > 0).map(s => (
              <circle
                key={s.key} className={styles.seg}
                cx="46" cy="46" r={DONUT_R} fill="none" stroke={s.color} strokeWidth="14"
                strokeDasharray={`${Math.max(s.len * k - 1.5, 0)} ${DONUT_C}`} strokeDashoffset={-s.start}
              />
            ))}
          </g>
        </svg>
        <div className={styles.donutLegend}>
          {entries.length === 0 && <span className={styles.empty}>Sin conversaciones</span>}
          {entries.map(e => (
            <div key={e.key} className={styles.donutRow}>
              <i style={{ background: e.color }} />
              <span>{e.label}</span>
              <b>{e.value}</b>
              <small>{pct(e.value, sum || total)}%</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AreaCard({ byArea, total }) {
  const max = Math.max(...byArea.map(a => a.handled), 1);
  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '520ms' }}>
      <div className={styles.cardHead}><h2 className={styles.cardTitle}>Por área</h2><small>derivadas</small></div>
      {byArea.length === 0 ? (
        <p className={styles.empty}>Sin derivaciones en el período</p>
      ) : byArea.map((a, i) => (
        <div key={a.id} className={styles.hb}>
          <div className={styles.hbName}>
            <span>{a.name}</span>
            <small>
              {a.handled} conv · {a.resolved} res.
              {a.avgFirstResponseMin != null && ` · ⏱ ${fmtMin(a.avgFirstResponseMin)}`} · {pct(a.handled, total)}%
            </small>
          </div>
          <div className={styles.hbTrack}>
            <i
              className={`${styles.hbFill} anim-grow-x`}
              style={{
                width: `${(a.handled / max) * 100}%`,
                background: `color-mix(in srgb, var(--brand) ${Math.max(100 - i * 22, 28)}%, white)`,
                '--d': `${700 + Math.min(i * 60, 300)}ms`,
              }}
            />
          </div>
          <b>{a.handled}</b>
        </div>
      ))}
    </section>
  );
}

function AgentCard({ byAgent, total, botName }) {
  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '570ms' }}>
      <div className={styles.cardHead}><h2 className={styles.cardTitle}>Por agente</h2><small>resueltas</small></div>
      {byAgent.length === 0 && <p className={styles.empty}>Sin actividad en el período</p>}
      {byAgent.map(a => {
        const isBot = a.id === 'bot';
        const name = isBot ? botName : a.name;
        return (
          <div key={a.id} className={styles.ag}>
            {isBot ? <BotFace size={30} /> : (
              <span className={styles.av} style={{ background: avatarColor(a.id || a.name) }}>{initials(a.name)}</span>
            )}
            <div className={styles.agBody}>
              <b>{name}</b>
              <small>{a.handled} conv · {a.messages ?? 0} msj · {pct(a.handled, total)}% del total</small>
            </div>
            <strong><Swap k={a.resolved}>{a.resolved}</Swap></strong>
          </div>
        );
      })}
    </section>
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
  const min = labels[labels.length - 1].count;
  const fontSize = (c) => (max === min ? 13 : 11.5 + ((c - min) / (max - min)) * 3.5);

  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '620ms' }}>
      <div className={styles.labelHeader}>
        <h2 className={styles.cardTitle}>Etiquetas</h2>
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
        <div className={styles.tags}>
          {visible.map((l, i) => {
            const tone = LABEL_TONES[i % LABEL_TONES.length];
            const isOpen = openLabel === l.name;
            return (
              <button
                key={l.name}
                type="button"
                className={`${styles.tag} ${isOpen ? styles.tagOpen : ''} anim-pop`}
                style={{ background: tone.bg, color: tone.fg, fontSize: `${fontSize(l.count).toFixed(1)}px`, '--d': `${760 + Math.min(i * 50, 400)}ms` }}
                onClick={() => toggleLabel(l.name)}
                aria-expanded={isOpen}
                title={`${pct(l.count, total)}% del total`}
              >
                {l.name} <b>{l.count}</b>
              </button>
            );
          })}
        </div>
      )}

      {openLabel && (
        <div className={styles.labelPanel}>
          <p className={styles.labelPanelTitle}>{openLabel}</p>
          {convsError && <p className={styles.labelConvsMsg}>{convsError}</p>}
          {!convsError && !convs && <p className={styles.labelConvsMsg}>Cargando conversaciones…</p>}
          {convs && (
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
      )}

      {!q && matches.length > LABELS_COLLAPSED && (
        <button type="button" className={styles.labelMore} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Ver menos' : `Ver todas (${matches.length})`}
        </button>
      )}
    </section>
  );
}

// Por qué se derivaron las charlas del período: lo que el bot no pudo
// resolver (con el motivo que eligió al derivar) separado de lo que el equipo
// tomó o arrancó por su cuenta. Tocá un motivo para ver las charlas.
function ReasonStats({ byReason, botName }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const groups = [
    { key: 'bot',  title: `Derivó ${botName}`, hint: 'no lo pudo resolver solo', items: byReason.filter(r => !r.team && r.reason !== 'sin_dato') },
    { key: 'team', title: 'Lo tomó el equipo', hint: 'plantillas, mensajes o tomas manuales', items: byReason.filter(r => r.team) },
    { key: 'old',  title: 'Sin motivo', hint: 'derivadas antes de que se empezara a registrar', items: byReason.filter(r => r.reason === 'sin_dato') },
  ].filter(g => g.items.length);
  const max = Math.max(...byReason.map(r => r.count), 1);

  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '600ms' }}>
      <div className={styles.cardHead}><h2 className={styles.cardTitle}>Motivos de derivación</h2><small>derivadas en el período</small></div>
      <p className={styles.labelHint}>Tocá un motivo para ver las conversaciones y el detalle que anotó {botName}.</p>
      {groups.map(g => (
        <div key={g.key} className={styles.reasonGroup}>
          <p className={styles.reasonGroupTitle}>
            {g.title} <small>· {g.items.reduce((s, r) => s + r.count, 0)} · {g.hint}</small>
          </p>
          {g.items.map((r, i) => {
            const isOpen = open === r.reason;
            return (
              <div key={r.reason}>
                <button
                  type="button"
                  className={`${styles.hb} ${styles.reasonRow} ${isOpen ? styles.reasonRowOpen : ''}`}
                  onClick={() => setOpen(isOpen ? null : r.reason)}
                  aria-expanded={isOpen}
                >
                  <div className={styles.hbName}><span>{r.label}</span></div>
                  <div className={styles.hbTrack}>
                    <i
                      className={`${styles.hbFill} anim-grow-x`}
                      style={{
                        width: `${(r.count / max) * 100}%`,
                        background: g.key === 'bot'
                          ? `color-mix(in srgb, var(--brand) ${Math.max(100 - i * 14, 35)}%, white)`
                          : 'color-mix(in srgb, var(--mute) 55%, white)',
                        '--d': `${680 + Math.min(i * 50, 300)}ms`,
                      }}
                    />
                  </div>
                  <b>{r.count}</b>
                </button>
                {isOpen && (
                  <ul className={`${styles.labelConvs} ${styles.reasonConvs}`}>
                    {r.examples.map((c, j) => (
                      <li key={`${c.id}-${j}`} className={styles.labelConv}>
                        <span className={styles.labelConvName}>{c.name || c.id}</span>
                        <span className={styles.labelConvMeta}>{c.detail || '—'}</span>
                        <span className={styles.labelConvMeta}>{fmtActivity(c.at)}</span>
                        {c.id && (
                          <button type="button" className={styles.labelConvOpen}
                            onClick={() => navigate(`/conversations?open=${encodeURIComponent(c.id)}`)}>
                            Abrir
                          </button>
                        )}
                      </li>
                    ))}
                    {r.count > r.examples.length && <li className={styles.labelConvsMsg}>…y {r.count - r.examples.length} más</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

const CART_STATUS = {
  purchased: { label: 'Comprado',   color: 'var(--color-status-resolved)' },
  pending:   { label: 'Pendiente',  color: '#f59e0b' },
  expired:   { label: 'Sin compra', color: '#94a3b8' },
};

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

  if (error) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Carritos del bot</h2>
        <p className={styles.empty}>No se pudieron cargar los carritos ({error}).</p>
      </section>
    );
  }
  if (!data) return null;

  const tiles = [
    { key: 'created',   label: 'Carritos creados', text: data.created, sub: data.created ? `${fmtMoney(data.cartsTotal)} en carritos` : undefined },
    { key: 'purchased', label: 'Comprados',        text: data.purchased, sub: data.pending ? `${data.pending} todavía pueden comprar` : undefined, color: 'var(--color-status-resolved)' },
    { key: 'conv',      label: 'Conversión',       text: `${data.conversionPct}%`, sub: 'carritos que terminaron en venta' },
    { key: 'sold',      label: 'Vendido',          text: fmtMoney(data.salesTotal), sub: 'total de esos pedidos' },
  ];
  const shown = showAll ? data.carts : data.carts.slice(0, 10);

  return (
    <section className={`${styles.card} anim-rise`} style={{ '--d': '700ms' }}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Carritos del bot</h2>
      </div>
      <p className={styles.labelHint}>
        Carritos que armó el bot en el período. Cuenta como comprado si ese mismo número de WhatsApp pagó un pedido con alguno de esos productos dentro de los {data.windowDays} días.
      </p>
      <div className={styles.tiles}>
        {tiles.map(t => (
          <div key={t.key} className={`${styles.tile} ${styles.tileFlat}`}>
            <small>{t.label}</small>
            <div className={styles.tileRow}>
              <strong style={t.color ? { color: t.color } : undefined}>{t.text}</strong>
            </div>
            {t.sub && <span className={styles.tileSub}>{t.sub}</span>}
          </div>
        ))}
      </div>
      {data.carts.length === 0 ? (
        <p className={styles.empty}>El bot no armó carritos en este período.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Estado</th><th>Pedido</th></tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} className={styles.rowLink} onClick={() => navigate(`/conversations?open=${encodeURIComponent(c.contactId)}`)}>
                  <td>
                    {fmtActivity(c.createdAt)}
                    {c.rebuilt > 1 && <div className={styles.tileSub}>armado {c.rebuilt} veces</div>}
                  </td>
                  <td>{c.contactId}</td>
                  <td>{c.items.map(i => `${i.quantity} x ${i.name}`).join(', ')}</td>
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
