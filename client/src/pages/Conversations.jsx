import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authFetch, BASE_URL } from '../lib/api';
import { useNotifications } from '../hooks/useNotifications.js';
import styles from './Conversations.module.css';


const STATUS_CONFIG = {
  bot:          { label: 'Bot activo',    cls: 'bot' },
  escalated:    { label: 'Con agente',    cls: 'escalated' },
  bot_archived: { label: 'Archivado Bot', cls: 'bot_archived' },
  resolved:     { label: 'Cerrado',       cls: 'resolved' },
  // Legacy
  urgent:       { label: 'Urgente',       cls: 'urgent' },
  waiting:      { label: 'En espera',     cls: 'waiting' },
};

const CHANNEL_CONFIG = {
  whatsapp:  { label: 'WhatsApp', cls: 'wpp' },
  instagram: { label: 'Instagram', cls: 'ig' },
};

const FILTERS = [
  { value: 'bot',           label: 'Bot' },
  { value: 'mine',          label: 'Mis casos' },
  { value: 'teams',         label: 'Equipos',  minRole: 'atencion_cliente' },
  { value: 'archived',      label: 'Archivados' },
];

const SLA_WARN_MS  = 15 * 60 * 1000;  // 15 min → amarillo
const SLA_ALERT_MS = 30 * 60 * 1000;  // 30 min → naranja
const SLA_CRIT_MS  = 60 * 60 * 1000;  // 60 min → rojo

function StatusChip({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bot' };
  return <span className={`${styles.chip} ${styles['chip_' + cfg.cls]}`}>{cfg.label}</span>;
}

function ChannelBadge({ channel }) {
  const cfg = CHANNEL_CONFIG[channel] ?? { label: channel, cls: 'wpp' };
  return <span className={`${styles.badge} ${styles['badge_' + cfg.cls]}`}>{cfg.label}</span>;
}

function AgentBadge({ assignedTo, nameMap = {} }) {
  if (!assignedTo) return null;
  return <span className={styles.agentBadge}>{nameMap[assignedTo] ?? assignedTo}</span>;
}

function LabelChip({ label, labelMap, onRemove }) {
  const color = labelMap[label] ?? '#6b7280';
  return (
    <span
      className={styles.labelChip}
      style={{ background: color + '22', color, borderColor: color + '55' }}
    >
      {label}
      {onRemove && (
        <button className={styles.labelChipRemove} onClick={() => onRemove(label)}>×</button>
      )}
    </span>
  );
}

function tsToDate(ts) {
  if (!ts) return null;
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return isNaN(d) ? null : d;
}

function formatAge(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) {
    const diffM = Math.floor(diffMs / (1000 * 60));
    return diffM < 1 ? 'ahora' : `${diffM}m`;
  }
  if (diffH < 24) return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
}

function formatTime(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  const datePart = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const timePart = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

function formatDate(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  return d.toLocaleDateString('es-AR');
}

function formatRecordTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function hoursAgo(ts) {
  const d = tsToDate(ts);
  if (!d) return 0;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60);
}

// Returns ms the client has been waiting for an agent response (0 if not waiting)
function getSlaWaitMs(conv) {
  if (!conv.humanMode) return 0;
  // Prefer the precise waitingSince field; fall back to lastClientMessageAt
  const since = conv.waitingSince ?? conv.lastClientMessageAt;
  const d = tsToDate(since);
  return d ? Math.max(0, Date.now() - d.getTime()) : 0;
}

function slaColor(waitMs) {
  if (waitMs >= SLA_CRIT_MS)  return '#ef4444';
  if (waitMs >= SLA_ALERT_MS) return '#f97316';
  if (waitMs >= SLA_WARN_MS)  return '#eab308';
  return null;
}

// Delivery status icon for agent messages
function MsgStatusIcon({ msgStatus }) {
  if (!msgStatus || msgStatus === 'sent') return <span className={styles.msgStatus}>✓</span>;
  if (msgStatus === 'sending') return <span className={styles.msgStatus}>⏳</span>;
  if (msgStatus === 'delivered') return <span className={styles.msgStatus}>✓✓</span>;
  if (msgStatus === 'read') return <span className={`${styles.msgStatus}`} style={{ color: '#3b82f6' }}>✓✓</span>;
  if (msgStatus === 'error') return <span className={`${styles.msgStatus} ${styles.msgStatusError}`}>✗ No enviado</span>;
  return null;
}

async function downloadMedia(url, suggestedExt = 'jpg') {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = blob.type?.split('/')[1]?.split('+')[0] || suggestedExt;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `imagen-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Si falla la descarga directa, al menos se puede guardar desde la
    // pestaña abierta con clic derecho → Guardar imagen como.
    window.open(url, '_blank');
  }
}

const REPLY_ROLE_LABELS = { user: 'Cliente', admin: 'Agente', assistant: 'Bot' };
const REPLY_PREVIEW_MAX = 80;

// Mismo recorte que `resolveReplyTo()` en bot.service.js, para que la cita se
// vea igual la arme el cliente (citando en WhatsApp) o el agente (citando
// desde el panel).
function buildReplyPreview(content) {
  const text = content ?? '';
  return text.length > REPLY_PREVIEW_MAX ? `${text.slice(0, REPLY_PREVIEW_MAX)}…` : text;
}

function MessageBubble({ msg, onRetry, onQuote, contactId, nameMap = {} }) {
  const isUser = msg.role === 'user';
  const isAdmin = msg.role === 'admin';
  // Mensajes viejos no tienen `sentBy` (se agregó después) — quedan mostrando
  // "Agente" genérico en vez de romper o mostrar un nombre incorrecto.
  const senderLabel = isUser ? 'Cliente' : isAdmin ? (nameMap[msg.sentBy] ?? 'Agente') : 'Bot';
  const token = localStorage.getItem('bot_token');
  const mediaProxyUrl = msg.mediaId
    ? `${BASE_URL}/api/conversations/media/${msg.mediaId}?token=${encodeURIComponent(token ?? '')}`
    : null;
  const isError = isAdmin && msg.msgStatus === 'error';
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [transcript, setTranscript] = useState(msg.transcript ?? null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState('');

  async function handleTranscribe() {
    setTranscribing(true);
    setTranscribeError('');
    try {
      const res = await authFetch(BASE_URL + `/api/conversations/${contactId}/media/${msg.mediaId}/transcribe`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al transcribir');
      setTranscript(data.transcript);
    } catch (err) {
      setTranscribeError(err.message);
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div className={`${styles.msg} ${isUser ? styles.msgUser : isAdmin ? styles.msgAdmin : styles.msgBot}`}>
      <div className={`${styles.msgBubble} ${isError ? styles.msgBubbleError : ''}`}>
        {msg.replyTo && (
          <div className={styles.msgReplyQuote}>
            <span className={styles.msgReplyQuoteFrom}>{REPLY_ROLE_LABELS[msg.replyTo.role] ?? ''}</span>
            <span className={styles.msgReplyQuoteText}>{msg.replyTo.preview}</span>
          </div>
        )}
        {msg.mediaType === 'image' && mediaProxyUrl && (
          <>
            <img
              src={mediaProxyUrl}
              className={styles.msgMedia}
              alt="Imagen"
              loading="lazy"
              onClick={() => setLightboxOpen(true)}
              title="Ver imagen"
            />
            {lightboxOpen && (
              <div className={styles.lightboxOverlay} onClick={() => setLightboxOpen(false)}>
                <div className={styles.lightboxContent} onClick={e => e.stopPropagation()}>
                  <img src={mediaProxyUrl} className={styles.lightboxImg} alt="Imagen ampliada" />
                  <div className={styles.lightboxActions}>
                    <button type="button" className={styles.lightboxBtn} onClick={() => downloadMedia(mediaProxyUrl)}>
                      ⬇ Descargar
                    </button>
                    <button type="button" className={styles.lightboxBtn} onClick={() => setLightboxOpen(false)}>
                      ✕ Cerrar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {msg.mediaType === 'audio' && mediaProxyUrl && (
          <div className={styles.msgAudioWrap}>
            <audio controls src={mediaProxyUrl} className={styles.msgAudio} />
            {transcript ? (
              <p className={styles.msgTranscript}>📝 {transcript}</p>
            ) : (
              <button type="button" className={styles.transcribeBtn} onClick={handleTranscribe} disabled={transcribing}>
                {transcribing ? 'Transcribiendo...' : '📝 Transcribir'}
              </button>
            )}
            {transcribeError && <p className={styles.msgTranscribeError}>{transcribeError}</p>}
          </div>
        )}
        {msg.mediaType === 'video' && mediaProxyUrl && (
          <video controls src={mediaProxyUrl} className={styles.msgVideo} />
        )}
        {msg.mediaType === 'document' && mediaProxyUrl && (
          <div className={styles.msgDocument}>
            <span className={styles.msgDocumentIcon}>📄</span>
            <a href={mediaProxyUrl} target="_blank" rel="noopener noreferrer" className={styles.msgDocumentOpen}>
              Abrir archivo
            </a>
            <button type="button" className={styles.msgDocumentDownload} onClick={() => downloadMedia(mediaProxyUrl, 'pdf')} title="Descargar">
              ⬇
            </button>
          </div>
        )}
        {msg.content && <span>{msg.content}</span>}
        {onRetry && (
          <button type="button" className={styles.retryBtn} onClick={() => onRetry(msg.content)}>
            ↩ Reenviar
          </button>
        )}
      </div>
      <span className={styles.msgMeta}>
        {senderLabel}
        {msg.timestamp ? ` · ${formatDateTime(msg.timestamp)}` : ''}
        {isAdmin && <MsgStatusIcon msgStatus={msg.msgStatus} />}
        {onQuote && msg.waMsgId && (
          <button
            type="button"
            className={styles.msgQuoteBtn}
            onClick={() => onQuote({ waMsgId: msg.waMsgId, role: msg.role, preview: buildReplyPreview(msg.content) })}
            title="Responder citando este mensaje"
          >
            ↩
          </button>
        )}
      </span>
    </div>
  );
}

function ConvItem({ conv, active, onClick, labelMap, nameMap = {} }) {
  const isUrgent = conv.urgent;
  const pendingMsgs = conv.consecutiveClientMessages ?? 0;
  const isInsistent = pendingMsgs >= 3;
  const isWaiting = pendingMsgs > 0 && conv.lastClientMessageAt;
  const waitMs = getSlaWaitMs(conv);
  const slaBadgeColor = slaColor(waitMs);

  return (
    <button
      className={`${styles.item} ${active ? styles.itemActive : ''}`}
      onClick={onClick}
    >
      <div className={styles.itemTop}>
        <span className={styles.itemName}>{conv.contactName || conv.contactId}</span>
        <div className={styles.itemTopRight}>
          <div className={styles.itemIndicators}>
            {conv.critical && <span className={styles.criticalBadge} title="Crítico — 4+ mensajes sin respuesta">🔴</span>}
            {isUrgent && <span className={styles.urgentFlagBadge} title="Urgente">⚡</span>}
            {isInsistent && <span className={styles.insistentBadge} title="Cliente insistente — escribió varias veces sin respuesta">⚠</span>}
            {isWaiting && (
              <span
                className={styles.waitTimeBadge}
                title="Tiempo esperando respuesta de agente"
                style={slaBadgeColor ? { background: slaBadgeColor + '22', color: slaBadgeColor, borderColor: slaBadgeColor + '66' } : undefined}
              >
                ⏳ {formatAge(conv.waitingSince ?? conv.lastClientMessageAt)}
              </span>
            )}
            {pendingMsgs > 0 && (
              <span className={styles.pendingMsgsBadge} title={`${pendingMsgs} mensaje${pendingMsgs > 1 ? 's' : ''} sin respuesta`}>
                {pendingMsgs} msg{pendingMsgs > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {conv.updatedAt && <span className={styles.itemAge}>{formatAge(conv.updatedAt)}</span>}
          {conv.unread > 0 && <span className={styles.itemUnread}>{conv.unread}</span>}
        </div>
      </div>
      <div className={styles.itemBottom}>
        <StatusChip status={conv.status || 'bot'} />
        <ChannelBadge channel={conv.channel} />
        <AgentBadge assignedTo={conv.assignedTo} nameMap={nameMap} />
      </div>
      {conv.lastMessage && <p className={styles.itemPreview}>{conv.lastMessage}</p>}
      {conv.labels?.length > 0 && (
        <div className={styles.itemLabels}>
          {conv.labels.map(l => (
            <span
              key={l}
              className={styles.labelChipSmall}
              style={{ background: (labelMap[l] ?? '#6b7280') + '22', color: labelMap[l] ?? '#6b7280', borderColor: (labelMap[l] ?? '#6b7280') + '55' }}
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export default function Conversations() {
  const { agent } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showMobileProfile, setShowMobileProfile] = useState(false); // mobile-only: perfil como panel deslizable
  const [messages, setMessages] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [filter, setFilter] = useState('bot');
  const [labelFilter, setLabelFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = no está buscando; array = resultados del backend
  const [searching, setSearching] = useState(false);
  const [archivedConversations, setArchivedConversations] = useState(null); // null = no cargado todavía
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // { waMsgId, role, preview } | null
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState(null); // { blob, url, mimeType } — grabado, pendiente de enviar/descartar
  const [updating, setUpdating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [allLabels, setAllLabels] = useState([]);
  const [labelDropOpen, setLabelDropOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState(null);
  const [newParams, setNewParams] = useState([]);
  const [newConvSaving, setNewConvSaving] = useState(false);
  const [newConvError, setNewConvError] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [areas, setAreas] = useState([]);
  const [agentsList, setAgentsList] = useState([]);
  const [nameMap, setNameMap] = useState({});
  const [teamsAreaFilter, setTeamsAreaFilter] = useState('');
  const [apiWindowError, setApiWindowError] = useState(false);
  const [templateSendOpen, setTemplateSendOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateParams, setTemplateParams] = useState([]);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [templateSendError, setTemplateSendError] = useState('');
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const atBottomRef = useRef(true);
  const prevMsgCountRef = useRef(0);
  const pollConvRef = useRef(null);
  const pollMsgRef = useRef(null);
  const selectedIdRef = useRef(null);
  const mediaInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const recordTimerRef = useRef(null);
  const appliedDeepLinkRef = useRef(false);

  const labelMap = Object.fromEntries(allLabels.map(l => [l.name, l.color]));
  const myId = agent?.id;

  useNotifications(conversations);

  useEffect(() => {
    loadConversations();
    loadAllLabels();
    loadQuickReplies();
    // Load areas + agents for name resolution
    Promise.all([
      authFetch(BASE_URL + '/api/areas').then(r => r.ok ? r.json() : { areas: [] }),
      authFetch(BASE_URL + '/api/auth/users').then(r => r.ok ? r.json() : []),
    ]).then(([areasData, agents]) => {
      const loadedAreas = areasData.areas ?? [];
      setAreas(loadedAreas);
      setAgentsList(agents.filter(a => a.role !== 'admin'));
      const map = {};
      for (const a of loadedAreas) map[a.id] = a.name;
      for (const a of agents) { map[a.email] = a.name; map[a.id] = a.name; }
      setNameMap(map);
    });
    pollConvRef.current = setInterval(loadConversations, 10000);
    return () => clearInterval(pollConvRef.current);
  }, []);

  // Deep-link: si se navegó con ?contact=<id> (p.ej. desde "Ver conversación"
  // en un ticket), selecciona esa conversación en cuanto la lista cargue.
  // Se aplica una sola vez (appliedDeepLinkRef): `conversations` cambia de
  // referencia en cada poll de 10s aunque el contenido sea el mismo, así que
  // sin este guard el efecto reasignaría la selección en cada poll y pelearía
  // contra una navegación manual posterior del agente.
  useEffect(() => {
    if (appliedDeepLinkRef.current) return;
    if (!conversations.length) return;
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const contactParam = params.get('contact');
    if (!contactParam) return;
    const match = conversations.find(c => c.id === contactParam || c.contactId === contactParam);
    if (match) {
      setSelected(match);
      appliedDeepLinkRef.current = true;
    }
  }, [conversations]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await authFetch(BASE_URL + `/api/conversations/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setSearchResults(data.conversations ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (filter === 'archived') loadArchivedConversations();
  }, [filter]);

  useEffect(() => {
    clearInterval(pollMsgRef.current);
    if (!selected) { setMessages([]); setCustomer(null); setSummary(null); return; }
    selectedIdRef.current = selected.id;
    atBottomRef.current = true;
    prevMsgCountRef.current = 0;
    loadMessages(selected.id);
    loadCustomer(selected.id);
    loadSummary(selected.id);
    markRead(selected.id);
    setLabelDropOpen(false);
    setQrOpen(false);
    // Reset window state when switching conversations
    setApiWindowError(false);
    setTemplateSendOpen(false);
    setSelectedTemplate(null);
    setTemplateParams([]);
    setTemplateSendError('');
    setReplyingTo(null);
    pollMsgRef.current = setInterval(() => loadMessages(selectedIdRef.current), 5000);
    return () => clearInterval(pollMsgRef.current);
  }, [selected?.id]);

  useEffect(() => {
    const newLen = messages.length;
    const hadMore = newLen > prevMsgCountRef.current;
    prevMsgCountRef.current = newLen;
    if (hadMore && atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }

  async function loadAllLabels() {
    try {
      const r = await authFetch(BASE_URL + '/api/labels');
      if (r.ok) setAllLabels(await r.json());
    } catch { /* ignore */ }
  }

  async function loadQuickReplies() {
    try {
      const r = await authFetch(BASE_URL + '/api/quick-replies');
      if (r.ok) setQuickReplies(await r.json());
    } catch { /* ignore */ }
  }

  async function loadTemplates() {
    try {
      const r = await authFetch(BASE_URL + '/api/templates');
      if (r.ok) setTemplates(await r.json());
    } catch { /* ignore */ }
  }

  function openNewConvModal() {
    setNewPhone(''); setNewName(''); setNewTemplate(null); setNewParams([]); setNewConvError('');
    if (templates.length === 0) loadTemplates();
    setShowNewConvModal(true);
  }

  function selectTemplate(tpl) {
    setNewTemplate(tpl);
    setNewParams(Array.isArray(tpl?.params) ? tpl.params.map(() => '') : []);
  }

  async function handleStartConversation(e) {
    e.preventDefault();
    if (!newPhone.trim() || !newTemplate) return;
    setNewConvSaving(true); setNewConvError('');
    try {
      const r = await authFetch(BASE_URL + '/api/conversations/start', {
        method: 'POST',
        body: {
          phone: newPhone.trim(),
          contactName: newName.trim() || null,
          templateName: newTemplate.name,
          language: newTemplate.language,
          params: newParams,
          createdBy: myId,
        },
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const conv = await r.json();
      setShowNewConvModal(false);
      await loadConversations();
      setSelected(conv);
      setFilter('mine');
    } catch (err) {
      setNewConvError(err.message);
    } finally {
      setNewConvSaving(false);
    }
  }

  async function loadConversations() {
    try {
      const res = await authFetch(BASE_URL + '/api/conversations');
      const data = await res.json();
      const list = data.conversations ?? [];
      setConversations(list);
      setSelected(prev => {
        if (!prev) return prev;
        return list.find(c => c.id === prev.id) ?? prev;
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadArchivedConversations() {
    setLoadingArchived(true);
    try {
      const res = await authFetch(BASE_URL + '/api/conversations/archived');
      const data = await res.json();
      setArchivedConversations(data.conversations ?? []);
    } catch {
      setArchivedConversations([]);
    } finally {
      setLoadingArchived(false);
    }
  }

  async function loadMessages(contactId) {
    try {
      const res = await authFetch(BASE_URL + `/api/conversations/${contactId}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch { setMessages([]); }
  }

  async function loadCustomer(contactId) {
    try {
      const res = await authFetch(BASE_URL + `/api/customers/${contactId}`);
      if (!res.ok) { setCustomer(null); return; }
      const data = await res.json();
      setCustomer(data.customer ?? null);
      setNotes(data.customer?.agentNotes ?? '');
    } catch { setCustomer(null); }
  }

  async function loadSummary(contactId) {
    try {
      const r = await authFetch(BASE_URL + `/api/conversations/${contactId}/summary`);
      if (r.ok) { const d = await r.json(); setSummary(d.summary ?? null); }
      else setSummary(null);
    } catch { setSummary(null); }
  }

  async function generateSummary() {
    if (!selected || summaryGenerating) return;
    setSummaryGenerating(true);
    try {
      const r = await authFetch(BASE_URL + `/api/conversations/${selected.id}/summary`, { method: 'POST' });
      if (r.ok) { const d = await r.json(); setSummary(d.summary ?? null); }
    } finally { setSummaryGenerating(false); }
  }

  async function markRead(contactId) {
    await authFetch(BASE_URL + `/api/conversations/${contactId}/read`, { method: 'POST' }).catch(() => {});
    setConversations(prev => prev.map(c => c.id === contactId ? { ...c, unread: 0 } : c));
  }

  async function saveNotes() {
    if (!selected || savingNotes) return;
    setSavingNotes(true);
    try {
      await authFetch(BASE_URL + `/api/customers/${selected.id}/notes`, {
        method: 'PATCH',
        body: { notes },
      });
    } finally { setSavingNotes(false); }
  }

  // dispatch supports extra body params (e.g. agentId for take_over)
  async function dispatch(action, extra = {}) {
    if (!selected || updating) return;
    setUpdating(true);
    try {
      const r = await authFetch(BASE_URL + `/api/conversations/${selected.id}/dispatch`, {
        method: 'PATCH',
        body: { action, ...extra },
      });
      if (r.ok) {
        const data = await r.json();
        const patch = {};
        if (data.status !== undefined)    patch.status = data.status;
        if (data.humanMode !== undefined)  patch.humanMode = data.humanMode;
        if (data.assignedTo !== undefined) patch.assignedTo = data.assignedTo;
        if (data.urgent !== undefined)     patch.urgent = data.urgent;
        setSelected(prev => ({ ...prev, ...patch }));
        setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, ...patch } : c));
      }
    } finally { setUpdating(false); }
  }

  async function addLabel(label) {
    if (!selected) return;
    setLabelDropOpen(false);
    if (selected.labels?.includes(label)) return;
    await authFetch(BASE_URL + `/api/labels/conversations/${selected.id}`, {
      method: 'PATCH',
      body: { action: 'add', label },
    });
    const updated = [...(selected.labels ?? []), label];
    setSelected(prev => ({ ...prev, labels: updated }));
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, labels: updated } : c));
  }

  async function removeLabel(label) {
    if (!selected) return;
    await authFetch(BASE_URL + `/api/labels/conversations/${selected.id}`, {
      method: 'PATCH',
      body: { action: 'remove', label },
    });
    const updated = (selected.labels ?? []).filter(l => l !== label);
    setSelected(prev => ({ ...prev, labels: updated }));
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, labels: updated } : c));
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim() || !selected || sending) return;
    setSending(true);
    const text = reply.trim();
    const quoted = replyingTo;
    setReply('');
    setReplyingTo(null);
    try {
      const res = await authFetch(BASE_URL + `/api/conversations/${selected.id}/reply`, {
        method: 'POST',
        body: { message: text, ...(quoted && { replyTo: quoted }) },
      });
      await loadMessages(selected.id);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.windowExpired) {
          setApiWindowError(true);
          if (templates.length === 0) loadTemplates();
        } else {
          alert(`⚠️ Mensaje guardado en el panel pero NO llegó al cliente.\n${data.error ?? 'Error desconocido'}`);
        }
      }
    } finally { setSending(false); }
  }

  async function handleRetry(text) {
    if (!selected || sending) return;
    setSending(true);
    try {
      const res = await authFetch(BASE_URL + `/api/conversations/${selected.id}/reply`, {
        method: 'POST',
        body: { message: text },
      });
      await loadMessages(selected.id);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.windowExpired) {
          setApiWindowError(true);
          if (templates.length === 0) loadTemplates();
        } else {
          alert(`⚠️ Reenvío fallido: ${data.error ?? 'Error desconocido'}`);
        }
      }
    } finally { setSending(false); }
  }

  async function sendTemplate() {
    if (!selected || !selectedTemplate || sendingTemplate) return;
    setSendingTemplate(true);
    setTemplateSendError('');
    try {
      const res = await authFetch(BASE_URL + `/api/conversations/${selected.id}/send-template`, {
        method: 'POST',
        body: { templateName: selectedTemplate.name, language: selectedTemplate.language, params: templateParams },
      });
      await loadMessages(selected.id);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTemplateSendError(data.error ?? 'Error enviando plantilla');
      } else {
        setTemplateSendOpen(false);
        setSelectedTemplate(null);
        setTemplateParams([]);
        setTemplateSendError('');
        // Don't clear apiWindowError yet — window only reopens when client replies
      }
    } finally {
      setSendingTemplate(false);
    }
  }

  function openTemplatePanel() {
    if (templates.length === 0) loadTemplates();
    setTemplateSendOpen(true);
    setSelectedTemplate(null);
    setTemplateParams([]);
    setTemplateSendError('');
  }

  function pickTemplate(id) {
    const tpl = templates.find(t => t.id === id) ?? null;
    setSelectedTemplate(tpl);
    setTemplateParams(tpl?.params?.map(() => '') ?? []);
  }

  async function handleMediaSelect(e) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    e.target.value = '';
    setSending(true);
    const quoted = replyingTo;
    setReplyingTo(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (quoted) form.append('replyTo', JSON.stringify(quoted));
      const r = await authFetch(BASE_URL + `/api/conversations/${selected.id}/media`, {
        method: 'POST',
        body: form,
      });
      await loadMessages(selected.id);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data.windowExpired) {
          setApiWindowError(true);
          if (templates.length === 0) loadTemplates();
        } else {
          alert(`⚠️ ${data.error ?? 'Error enviando archivo'}`);
        }
      }
    } finally { setSending(false); }
  }

  // WhatsApp acepta audio/ogg (opus), audio/mp4, audio/mpeg, audio/amr, audio/aac como
  // adjunto — pero MediaRecorder en Chrome sólo graba nativamente en audio/webm. Se prueba
  // en este orden para usar el formato "nativo" de WhatsApp cuando el navegador lo soporte
  // (Firefox sí puede grabar ogg/opus directo) y sólo cae a webm si no hay otra opción.
  const AUDIO_MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

  function pickAudioMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    return AUDIO_MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  async function startRecording() {
    if (recording || !selected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecordedAudio({ blob, url: URL.createObjectURL(blob), mimeType: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch {
      alert('No se pudo acceder al micrófono. Revisá los permisos del navegador para este sitio.');
    }
  }

  function stopRecording() {
    if (!recording) return;
    mediaRecorderRef.current?.stop();
    setRecording(false);
    clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
  }

  function discardRecordedAudio() {
    if (recordedAudio) URL.revokeObjectURL(recordedAudio.url);
    setRecordedAudio(null);
    setRecordSeconds(0);
  }

  async function sendRecordedAudio() {
    if (!recordedAudio || !selected || sending) return;
    setSending(true);
    const quoted = replyingTo;
    setReplyingTo(null);
    try {
      const ext = recordedAudio.mimeType.includes('ogg') ? 'ogg' : recordedAudio.mimeType.includes('mp4') ? 'm4a' : 'webm';
      const form = new FormData();
      form.append('file', recordedAudio.blob, `nota-de-voz.${ext}`);
      if (quoted) form.append('replyTo', JSON.stringify(quoted));
      const r = await authFetch(BASE_URL + `/api/conversations/${selected.id}/media`, {
        method: 'POST',
        body: form,
      });
      await loadMessages(selected.id);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data.windowExpired) {
          setApiWindowError(true);
          if (templates.length === 0) loadTemplates();
        } else {
          alert(`⚠️ ${data.error ?? 'Error enviando audio'}`);
        }
      }
    } finally {
      setSending(false);
      URL.revokeObjectURL(recordedAudio.url);
      setRecordedAudio(null);
      setRecordSeconds(0);
    }
  }

  // Si cambia la conversación seleccionada (o se desmonta la página) con una grabación en
  // curso o pendiente de enviar, se descarta — no tiene sentido mandarla a otro contacto.
  useEffect(() => {
    setRecordedAudio(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
    setRecording(false);
    setRecordSeconds(0);
    setShowMobileProfile(false);
    return () => {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
      clearInterval(recordTimerRef.current);
    };
  }, [selected?.id]);

  const isHuman = selected?.humanMode;
  const currentStatus = selected?.status || 'bot';
  const isArchived = currentStatus === 'bot_archived' || currentStatus === 'resolved';
  const isUrgentFlag = selected?.urgent === true;
  const availableToAdd = allLabels.filter(l => !(selected?.labels ?? []).includes(l.name));

  const slashMatch = reply.match(/^\/(\w*)$/);
  const slashSuggestions = slashMatch
    ? quickReplies.filter(qr => (qr.shortcut ?? '').startsWith(slashMatch[1]))
    : [];

  // 24h WhatsApp window detection
  const lastClientHours = selected?.lastClientMessageAt
    ? hoursAgo(selected.lastClientMessageAt)
    : null;
  // Computed: client hasn't written in >24h (window likely expired)
  const computedWindowExpired = isHuman && lastClientHours !== null && lastClientHours > 24;
  // Combined: either computed from timestamp OR detected from API error response
  const isWindowExpired = computedWindowExpired || apiWindowError;
  // Warning shown when window is approaching (>20h) but not yet expired
  const windowApproaching = isHuman && lastClientHours !== null && lastClientHours > 20 && !isWindowExpired;
  // Clear apiWindowError when the window re-opens (client responds and lastClientHours resets)
  if (apiWindowError && !computedWindowExpired && lastClientHours !== null && lastClientHours < 1) {
    setApiWindowError(false);
  }

  const approvedTemplates = templates.filter(t => t.metaStatus === 'APPROVED');

  const filtered = searchResults !== null
    ? searchResults
    : filter === 'archived'
      ? (archivedConversations ?? []).filter(c => !labelFilter || (c.labels ?? []).includes(labelFilter))
      : conversations.filter(c => {
        const status = c.status || 'bot';
        const isConvArchived = status === 'bot_archived' || status === 'resolved';
        const convUrgent = c.urgent === true;
        const convHuman = c.humanMode === true;

        if (filter === 'bot') {
          if (isConvArchived) return false;
          if (convHuman) return false;
          if (status !== 'bot') return false;
        } else if (filter === 'mine') {
          if (isConvArchived) return false;
          const myAreaIds = agent?.areaIds ?? [];
          if (!convHuman || (c.assignedTo !== myId && !myAreaIds.includes(c.assignedTo))) return false;
        } else if (filter === 'critical') {
          if (isConvArchived) return false;
          if (!c.critical) return false;
        } else if (filter === 'urgent') {
          if (isConvArchived) return false;
          if (!convUrgent) return false;
        } else if (filter === 'waiting') {
          if (isConvArchived) return false;
          if (!convHuman) return false;
          if (getSlaWaitMs(c) < 60 * 60 * 1000) return false;
        } else if (filter === 'teams') {
          if (isConvArchived) return false;
          if (!convHuman) return false;
          if (teamsAreaFilter && c.assignedTo !== teamsAreaFilter) return false;
        }

        if (labelFilter && !(c.labels ?? []).includes(labelFilter)) return false;
        return true;
      });

  if (filter === 'waiting') {
    filtered.sort((a, b) => getSlaWaitMs(b) - getSlaWaitMs(a));
  }

  return (
    <div className={styles.page}>
      {/* ---- Sidebar ---- */}
      <aside className={`${styles.sidebar} ${selected ? styles.mobileHiddenPanel : ''}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarTop}>
            <h1 className={styles.sidebarTitle}>Conversaciones</h1>
            <button className={styles.newConvBtn} onClick={openNewConvModal} title="Nueva conversación">＋</button>
          </div>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Buscar contacto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className={styles.chips}>
            {FILTERS.filter(f => {
              if (!f.minRole) return true;
              if (f.minRole === 'atencion_cliente') return agent?.role === 'admin' || agent?.role === 'atencion_cliente';
              if (f.minRole === 'admin') return agent?.role === 'admin';
              return true;
            }).map(f => (
              <button
                key={f.value}
                onClick={() => { setFilter(f.value); if (f.value !== 'teams') setTeamsAreaFilter(''); }}
                className={`${styles.filterChip} ${filter === f.value ? styles.filterChipActive : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {filter === 'teams' && areas.length > 0 && (
            <select
              className={styles.labelSelect}
              value={teamsAreaFilter}
              onChange={e => setTeamsAreaFilter(e.target.value)}
            >
              <option value="">Todas las áreas</option>
              {areas.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          {allLabels.length > 0 && (
            <select
              className={styles.labelSelect}
              value={labelFilter ?? ''}
              onChange={e => setLabelFilter(e.target.value || null)}
            >
              <option value="">Todas las etiquetas</option>
              {allLabels.map(l => (
                <option key={l.id} value={l.name}>{l.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className={styles.convList}>
          {loading ? (
            <p className={styles.empty}>Cargando...</p>
          ) : searching ? (
            <p className={styles.empty}>Buscando...</p>
          ) : (filter === 'archived' && loadingArchived) ? (
            <p className={styles.empty}>Cargando archivados...</p>
          ) : filtered.length === 0 ? (
            <p className={styles.empty}>Sin resultados.</p>
          ) : (
            filtered.map(c => (
              <ConvItem
                key={c.id}
                conv={c}
                active={selected?.id === c.id}
                onClick={() => setSelected(c)}
                labelMap={labelMap}
                nameMap={nameMap}
              />
            ))
          )}
        </div>
      </aside>

      {/* ---- Thread ---- */}
      <main className={`${styles.thread} ${!selected ? styles.mobileHiddenPanel : ''}`}>
        {!selected ? (
          <div className={styles.threadEmpty}>
            <div className={styles.threadEmptyIcon}>💬</div>
            <p>Seleccioná una conversación</p>
          </div>
        ) : (
          <>
            <div className={styles.threadHeader}>
              {/* Row 1: name + close/reopen */}
              <div className={styles.threadHeaderTop}>
                <button
                  type="button"
                  className={styles.backBtn}
                  onClick={() => setSelected(null)}
                  title="Volver al listado"
                >
                  ←
                </button>
                <span className={styles.threadName}>
                  {selected.contactName || selected.contactId}
                  {isUrgentFlag && <span style={{ marginLeft: 6, fontSize: 14 }}>⚡</span>}
                </span>
                <div className={styles.threadActions}>
                  <button
                    type="button"
                    className={styles.profileToggleBtn}
                    onClick={() => setShowMobileProfile(v => !v)}
                    title="Ver perfil del cliente"
                  >
                    👤
                  </button>
                  {isArchived ? (
                    <button className={`${styles.actionBtn} ${styles.actionReopen}`} onClick={() => dispatch('to_bot')} disabled={updating}>
                      ↩ Reabrir
                    </button>
                  ) : (
                    <button
                      className={`${styles.actionBtn} ${styles.actionResolve}`}
                      onClick={() => dispatch('bot_archive')}
                      disabled={updating}
                      title="Archivar conversación"
                    >
                      ✓ Archivar
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: badges + dispatch actions */}
              <div className={styles.threadHeaderBottom}>
                <div className={styles.threadHeaderBadges}>
                  <ChannelBadge channel={selected.channel} />
                  <StatusChip status={currentStatus} />
                  {selected.assignedTo && <AgentBadge assignedTo={selected.assignedTo} nameMap={nameMap} />}
                </div>

                {!isArchived && (
                  <div className={styles.dispatchActions}>
                    <button
                      className={`${styles.dispatchBtn} ${styles.dispatchBotBtn} ${!isHuman && currentStatus === 'bot' ? styles.dispatchBtnActive : ''}`}
                      onClick={() => dispatch('to_bot')}
                      disabled={updating}
                      title="Enviar al Bot"
                    >
                      🤖 Bot
                    </button>

                    {/* Take over button: visible when bot is handling the conv */}
                    {!isHuman && currentStatus === 'bot' && (
                      <button
                        className={styles.takeOverBtn}
                        onClick={() => dispatch('take_over', { agentId: myId })}
                        disabled={updating}
                        title="Tomar esta conversación — el bot deja de responder"
                      >
                        ✋ Tomar
                      </button>
                    )}

                    {agentsList.length > 0 && (
                      <select
                        className={styles.agentSelect}
                        value=""
                        onChange={e => { if (e.target.value) dispatch('assign_to', { assignedTo: e.target.value }); }}
                        disabled={updating}
                        title="Derivar a agente específico"
                      >
                        <option value="">→ Agente...</option>
                        {agentsList.map(a => (
                          <option key={a.id} value={a.email}>{a.name}</option>
                        ))}
                      </select>
                    )}

                    {/* Urgent toggle: always visible, toggles the flag */}
                    {isUrgentFlag ? (
                      <button
                        className={`${styles.dispatchBtn} ${styles.dispatchUnurgentBtn}`}
                        onClick={() => dispatch('unset_urgent')}
                        disabled={updating}
                        title="Quitar urgente"
                      >
                        ⚡ Quitar urgente
                      </button>
                    ) : (
                      <button
                        className={`${styles.dispatchBtn} ${styles.dispatchUrgentBtn}`}
                        onClick={() => dispatch('set_urgent')}
                        disabled={updating}
                        title="Marcar como urgente"
                      >
                        ⚡ Urgente
                      </button>
                    )}
                  </div>
                )}

                <div className={styles.labelsRow}>
                  {(selected.labels ?? []).map(l => (
                    <LabelChip key={l} label={l} labelMap={labelMap} onRemove={!isArchived ? removeLabel : null} />
                  ))}
                  {!isArchived && (
                    <div className={styles.labelAddWrap}>
                      <button
                        className={styles.labelAddBtn}
                        onClick={() => setLabelDropOpen(v => !v)}
                        title="Agregar etiqueta"
                      >
                        + Etiqueta
                      </button>
                      {labelDropOpen && availableToAdd.length > 0 && (
                        <div className={styles.labelDropdown}>
                          {availableToAdd.map(l => (
                            <button
                              key={l.id}
                              className={styles.labelDropItem}
                              onClick={() => addLabel(l.name)}
                            >
                              <span className={styles.labelDropDot} style={{ background: l.color }} />
                              {l.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {labelDropOpen && availableToAdd.length === 0 && (
                        <div className={styles.labelDropdown}>
                          <span className={styles.labelDropEmpty}>Sin etiquetas disponibles</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className={styles.messages}
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
            >
              {messages.length === 0 ? (
                <p className={styles.noMessages}>Sin mensajes aún.</p>
              ) : (
                messages.map((msg, i) => {
                  const canRetry = msg.role === 'admin' && msg.msgStatus === 'error'
                    && msg.content?.trim() && !msg.mediaType
                    && !msg.content.startsWith('[Plantilla:');
                  return (
                    <MessageBubble
                      key={i}
                      msg={msg}
                      onRetry={canRetry ? handleRetry : null}
                      onQuote={isHuman ? setReplyingTo : null}
                      contactId={selected.id}
                      nameMap={nameMap}
                    />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Footer: depends on conversation state */}
            {isArchived ? (
              <div className={styles.archivedBanner}>
                <span>Conversación archivada</span>
                <button
                  className={`${styles.dispatchBtn}`}
                  onClick={() => dispatch('to_bot')}
                  disabled={updating}
                >
                  ↩ Reabrir al Bot
                </button>
              </div>
            ) : isWindowExpired ? (
              /* ---- Window expired: block text, force template ---- */
              <div className={styles.windowExpiredPanel}>
                <div className={styles.windowExpiredHeader}>
                  <span className={styles.windowExpiredIcon}>⛔</span>
                  <div>
                    <p className={styles.windowExpiredTitle}>Ventana de WhatsApp expirada</p>
                    <p className={styles.windowExpiredDesc}>
                      {lastClientHours !== null
                        ? `El cliente no escribió en las últimas ${Math.floor(lastClientHours)}h.`
                        : 'El cliente no ha iniciado la conversación.'}
                      {' '}No podés enviar mensajes de texto libre. Solo podés enviar una <strong>plantilla aprobada</strong> para retomar el contacto.
                    </p>
                  </div>
                </div>

                {!templateSendOpen ? (
                  <button className={styles.openTemplateSendBtn} onClick={openTemplatePanel}>
                    Enviar plantilla aprobada
                  </button>
                ) : (
                  <div className={styles.templateSendForm}>
                    {approvedTemplates.length === 0 ? (
                      <p className={styles.noApprovedWarning}>
                        No tenés plantillas aprobadas. Creá una en la sección Plantillas y esperá la aprobación de Meta.
                      </p>
                    ) : (
                      <>
                        <select
                          className={styles.templateSendSelect}
                          value={selectedTemplate?.id ?? ''}
                          onChange={e => pickTemplate(e.target.value)}
                        >
                          <option value="">Seleccioná una plantilla aprobada...</option>
                          {approvedTemplates.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.displayName} ({t.name})
                            </option>
                          ))}
                        </select>

                        {selectedTemplate && (
                          <div className={styles.templatePreviewInChat}>
                            <p className={styles.templatePreviewText}>{selectedTemplate.bodyText}</p>
                          </div>
                        )}

                        {selectedTemplate?.params?.length > 0 && selectedTemplate.params.map((desc, i) => (
                          <div key={i} className={styles.templateParamRow}>
                            <span className={styles.templateParamLabel}>{`{{${i + 1}}}`} {desc}</span>
                            <input
                              className={styles.templateParamInput}
                              type="text"
                              placeholder={desc}
                              value={templateParams[i] ?? ''}
                              onChange={e => setTemplateParams(prev => {
                                const n = [...prev]; n[i] = e.target.value; return n;
                              })}
                            />
                          </div>
                        ))}

                        {templateSendError && (
                          <p className={styles.templateSendError}>⚠️ {templateSendError}</p>
                        )}

                        <div className={styles.templateSendActions}>
                          <button
                            className={styles.templateSendCancelBtn}
                            onClick={() => { setTemplateSendOpen(false); setSelectedTemplate(null); }}
                          >
                            Cancelar
                          </button>
                          <button
                            className={styles.templateSendSubmitBtn}
                            onClick={sendTemplate}
                            disabled={!selectedTemplate || sendingTemplate}
                          >
                            {sendingTemplate ? 'Enviando...' : 'Enviar plantilla'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : isHuman ? (
              /* ---- Normal agent reply form ---- */
              <form className={styles.replyForm} onSubmit={sendReply}>
                <div className={styles.replyHumanBadge}>
                  Modo agente — Bot no responde · Respondiendo como <strong>{nameMap[myId] ?? myId}</strong>
                </div>
                {replyingTo && (
                  <div className={styles.replyingToBar}>
                    <div className={styles.replyingToText}>
                      <span className={styles.msgReplyQuoteFrom}>
                        Respondiendo a {REPLY_ROLE_LABELS[replyingTo.role] ?? ''}
                      </span>
                      <span className={styles.msgReplyQuoteText}>{replyingTo.preview}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.replyingToCancel}
                      onClick={() => setReplyingTo(null)}
                      title="Cancelar cita"
                    >
                      ✕
                    </button>
                  </div>
                )}
                {windowApproaching && (
                  <div className={styles.windowWarning}>
                    ⚠️ El cliente no escribe hace {Math.floor(lastClientHours)}h. La ventana de WhatsApp de 24h está por cerrarse — si no responde pronto, los mensajes dejarán de llegar.
                  </div>
                )}
                {recordedAudio ? (
                  /* ---- Preview de nota de voz grabada: escuchar antes de mandar ---- */
                  <div className={styles.recordPreviewRow}>
                    <audio className={styles.recordPreviewPlayer} controls src={recordedAudio.url} />
                    <button
                      type="button"
                      className={styles.recordDiscardBtn}
                      onClick={discardRecordedAudio}
                      disabled={sending}
                      title="Descartar grabación"
                    >
                      🗑 Descartar
                    </button>
                    <button
                      type="button"
                      className={styles.replyBtn}
                      onClick={sendRecordedAudio}
                      disabled={sending}
                    >
                      {sending ? '...' : '📤 Enviar audio'}
                    </button>
                  </div>
                ) : recording ? (
                  /* ---- Grabando nota de voz ---- */
                  <div className={styles.recordingRow}>
                    <span className={styles.recordingDot} />
                    <span className={styles.recordingTime}>Grabando… {formatRecordTime(recordSeconds)}</span>
                    <button
                      type="button"
                      className={styles.recordCancelBtn}
                      onClick={cancelRecording}
                      title="Cancelar grabación"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className={styles.recordStopBtn}
                      onClick={stopRecording}
                      title="Cortar grabación"
                    >
                      ⏹ Cortar
                    </button>
                  </div>
                ) : (
                <div className={styles.replyRow}>
                  <div className={styles.replyInputWrap}>
                    {slashSuggestions.length > 0 && (
                      <div className={styles.slashDropdown}>
                        {slashSuggestions.map(qr => (
                          <button
                            type="button"
                            key={qr.id}
                            className={styles.slashDropItem}
                            onClick={() => setReply(qr.text)}
                          >
                            <span className={styles.slashDropShortcut}>/{qr.shortcut}</span>
                            <span className={styles.slashDropTitle}>{qr.title || qr.shortcut}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      className={styles.replyInput}
                      rows={2}
                      placeholder="Escribí tu respuesta... (Enter para enviar)"
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(e); } }}
                      disabled={sending}
                      spellCheck="true"
                      lang="es"
                    />
                    {quickReplies.length > 0 && (
                      <div className={styles.qrWrap}>
                        <button
                          type="button"
                          className={styles.qrBtn}
                          onClick={() => setQrOpen(v => !v)}
                          title="Respuestas rápidas"
                        >
                          ⚡
                        </button>
                        {qrOpen && (
                          <div className={styles.qrDropdown}>
                            {quickReplies.map(qr => (
                              <button
                                type="button"
                                key={qr.id}
                                className={styles.qrDropItem}
                                onClick={() => { setReply(qr.text); setQrOpen(false); }}
                              >
                                <span className={styles.qrDropTitle}>
                                  {qr.shortcut && <code className={styles.qrDropShortcut}>/{qr.shortcut}</code>}
                                  {qr.title || qr.shortcut}
                                </span>
                                <span className={styles.qrDropText}>{qr.text}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    ref={mediaInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className={styles.mediaFileInput}
                    onChange={handleMediaSelect}
                    disabled={sending}
                  />
                  <button
                    type="button"
                    className={styles.mediaBtn}
                    onClick={() => mediaInputRef.current?.click()}
                    disabled={sending}
                    title="Enviar imagen / video / audio / documento"
                  >
                    📎
                  </button>
                  <button
                    type="button"
                    className={styles.micBtn}
                    onClick={startRecording}
                    disabled={sending}
                    title="Grabar nota de voz"
                  >
                    🎙️
                  </button>
                  <button type="submit" className={styles.replyBtn} disabled={sending || !reply.trim()}>
                    {sending ? '...' : 'Enviar'}
                  </button>
                </div>
                )}
              </form>
            ) : (
              /* ---- Bot is handling the conversation ---- */
              <div className={styles.botFooter}>
                <span className={styles.botFooterDot} />
                <span className={styles.botFooterText}>El bot está respondiendo automáticamente</span>
                <button
                  className={styles.takeOverBtn}
                  onClick={() => dispatch('take_over', { agentId: myId })}
                  disabled={updating}
                  style={{ marginLeft: 8 }}
                  title="Intervenir — el bot deja de responder"
                >
                  ✋ Tomar conversación
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ---- Profile Panel ---- */}
      {selected && (
        <>
          {showMobileProfile && (
            <div className={styles.profileBackdrop} onClick={() => setShowMobileProfile(false)} />
          )}
          <aside className={`${styles.profilePanel} ${showMobileProfile ? styles.profilePanelOpen : ''}`}>
          <div className={styles.profileHeader}>
            <button
              type="button"
              className={styles.profileCloseBtn}
              onClick={() => setShowMobileProfile(false)}
              title="Cerrar"
            >
              ✕
            </button>
            <span className={styles.profileTitle}>Perfil del cliente</span>
          </div>

          {customer ? (
            <>
              <div className={styles.profileSection}>
                {customer.contactName && (
                  <div className={styles.profileRow}>
                    <span className={styles.profileKey}>Nombre</span>
                    <span className={styles.profileVal}>{customer.contactName}</span>
                  </div>
                )}
                {customer.channel === 'whatsapp' && customer.id && (
                  <div className={styles.profileRow}>
                    <span className={styles.profileKey}>Teléfono</span>
                    <span className={styles.profileVal}>+{customer.id}</span>
                  </div>
                )}
                <div className={styles.profileRow}>
                  <span className={styles.profileKey}>Canal</span>
                  <span className={styles.profileVal}>{customer.channel}</span>
                </div>
                {customer.firstContactAt && (
                  <div className={styles.profileRow}>
                    <span className={styles.profileKey}>1er contacto</span>
                    <span className={styles.profileVal}>{formatDate(customer.firstContactAt)}</span>
                  </div>
                )}
              </div>

              <div className={styles.profileSection}>
                <div className={styles.summaryHeader}>
                  <span className={styles.profileSectionTitle}>Resumen IA</span>
                  <button
                    className={styles.summaryBtn}
                    onClick={generateSummary}
                    disabled={summaryGenerating}
                  >
                    {summaryGenerating ? '...' : summary ? '↻ Actualizar' : 'Generar'}
                  </button>
                </div>
                {summary ? (
                  <>
                    <p className={styles.summaryText}>{summary.text}</p>
                    <div className={styles.summaryMetrics}>
                      <span className={styles.metricChip}>💬 {summary.metrics?.totalMessages ?? '?'} msgs</span>
                      {summary.metrics?.agentMessages > 0 && (
                        <span className={styles.metricChip}>👤 {summary.metrics.agentMessages} agente</span>
                      )}
                      {summary.metrics?.assignedTo && (
                        <span className={styles.metricChip}>→ {summary.metrics.assignedTo}</span>
                      )}
                      {summary.metrics?.avgResponseTimeSec != null && (
                        <span className={styles.metricChip}>⏱ {summary.metrics.avgResponseTimeSec}s resp.</span>
                      )}
                    </div>
                    {summary.generatedAt && (
                      <span className={styles.summaryTimestamp}>
                        Generado {formatDate(summary.generatedAt)}
                      </span>
                    )}
                  </>
                ) : (
                  <p className={styles.profileEmpty}>
                    {summaryGenerating ? 'Generando resumen...' : 'Sin resumen. Hacé click en "Generar".'}
                  </p>
                )}
              </div>

              <div className={styles.profileSection}>
                <div className={styles.profileSectionTitle}>Notas del equipo</div>
                <textarea
                  className={styles.notesInput}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Anotaciones internas sobre este cliente..."
                  rows={4}
                />
                <button className={styles.saveNotesBtn} onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? 'Guardando...' : 'Guardar notas'}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.profileEmpty}>Sin perfil aún.</p>
          )}
          </aside>
        </>
      )}

      {/* ---- Nueva Conversación Modal ---- */}
      {showNewConvModal && (
        <div className={styles.newConvOverlay} onClick={e => e.target === e.currentTarget && setShowNewConvModal(false)}>
          <div className={styles.newConvModal}>
            <div className={styles.newConvModalHeader}>
              <span className={styles.newConvModalTitle}>Nueva conversación</span>
              <button className={styles.newConvCloseBtn} onClick={() => setShowNewConvModal(false)}>×</button>
            </div>
            <form className={styles.newConvForm} onSubmit={handleStartConversation}>
              <div className={styles.newConvRow}>
                <div className={styles.newConvField}>
                  <label className={styles.newConvLabel}>Teléfono *</label>
                  <input
                    className={styles.newConvInput}
                    type="tel"
                    placeholder="ej: 5491112345678"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 15))}
                    autoFocus
                  />
                </div>
                <div className={styles.newConvField}>
                  <label className={styles.newConvLabel}>Nombre del contacto</label>
                  <input
                    className={styles.newConvInput}
                    type="text"
                    placeholder="ej: María García"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    maxLength={60}
                  />
                </div>
              </div>
              <div className={styles.newConvField}>
                <label className={styles.newConvLabel}>Plantilla aprobada *</label>
                {templates.length === 0 ? (
                  <p className={styles.newConvHint}>Sin plantillas. Creá una en la sección Plantillas primero.</p>
                ) : templates.every(t => t.metaStatus !== 'APPROVED') ? (
                  <p className={styles.newConvHint}>
                    Ninguna plantilla está aprobada por Meta todavía. Creá una plantilla y esperá la aprobación, o sincronizá el estado en la sección Plantillas.
                  </p>
                ) : (
                  <select
                    className={styles.newConvSelect}
                    value={newTemplate?.id ?? ''}
                    onChange={e => selectTemplate(templates.find(t => t.id === e.target.value) ?? null)}
                  >
                    <option value="">Seleccionar plantilla aprobada...</option>
                    {templates.map(t => {
                      const approved = t.metaStatus === 'APPROVED';
                      if (!approved) return null;
                      return (
                        <option key={t.id} value={t.id}>
                          ✓ {t.displayName} ({t.name})
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
              {newTemplate && (
                <div className={styles.newConvPreview}>
                  <span className={styles.newConvPreviewText}>{newTemplate.bodyText}</span>
                </div>
              )}
              {newTemplate?.params?.length > 0 && (
                <div className={styles.newConvParamsGroup}>
                  <label className={styles.newConvLabel}>Parámetros de la plantilla</label>
                  {newTemplate.params.map((desc, i) => (
                    <div key={i} className={styles.newConvParamRow}>
                      <span className={styles.newConvParamLabel}>{`{{${i + 1}}}`} {desc}</span>
                      <input
                        className={styles.newConvInput}
                        type="text"
                        placeholder={desc}
                        value={newParams[i] ?? ''}
                        onChange={e => setNewParams(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                      />
                    </div>
                  ))}
                </div>
              )}
              {newConvError && <p className={styles.newConvError}>{newConvError}</p>}
              <div className={styles.newConvFooter}>
                <button type="button" className={styles.newConvCancelBtn} onClick={() => setShowNewConvModal(false)}>Cancelar</button>
                <button
                  className={styles.newConvSubmitBtn}
                  type="submit"
                  disabled={newConvSaving || !newPhone.trim() || !newTemplate}
                >
                  {newConvSaving ? 'Enviando...' : 'Iniciar conversación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
