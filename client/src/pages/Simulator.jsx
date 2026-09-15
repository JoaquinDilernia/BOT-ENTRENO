import { useState, useRef, useEffect } from 'react';
import { authFetch } from '../lib/api';
import styles from './Simulator.module.css';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const PRESET_USERS = [
  { contactId: 'test_5491123456789', contactName: 'María García', channel: 'whatsapp' },
  { contactId: 'test_5491198765432', contactName: 'Laura Pérez', channel: 'whatsapp' },
  { contactId: 'ig_test_001',       contactName: 'Ana Rodríguez', channel: 'instagram' },
];

function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export default function Simulator() {
  const [contactId, setContactId] = useState(PRESET_USERS[0].contactId);
  const [contactName, setContactName] = useState(PRESET_USERS[0].contactName);
  const [channel, setChannel] = useState(PRESET_USERS[0].channel);
  const [messages, setMessages] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  function selectPreset(preset) {
    setContactId(preset.contactId);
    setContactName(preset.contactName);
    setChannel(preset.channel);
    setMessages([]);
    setCustomer(null);
    setError(null);
  }

  async function sendMessage(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setError(null);

    // Optimistically show user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }]);

    try {
      const res = await authFetch(`${API}/api/test/message`, {
        method: 'POST',
        body: { contactId, contactName, channel, message: text },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error desconocido');

      setMessages(data.messages ?? []);
      setCustomer(data.customer ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const isCustomPreset = !PRESET_USERS.find(p => p.contactId === contactId);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Simulador</h1>
        <p className={styles.subtitle}>Probá el bot sin Meta — cada mensaje procesa la lógica completa</p>
      </div>

      <div className={styles.layout}>
        {/* Config panel */}
        <div className={styles.configPanel}>
          <div className={styles.panelSection}>
            <div className={styles.sectionLabel}>Usuario de prueba</div>
            <div className={styles.presets}>
              {PRESET_USERS.map(p => (
                <button
                  key={p.contactId}
                  className={`${styles.presetBtn} ${contactId === p.contactId ? styles.presetBtnActive : ''}`}
                  onClick={() => selectPreset(p)}
                >
                  <span className={styles.presetName}>{p.contactName}</span>
                  <span className={`${styles.presetChannel} ${p.channel === 'instagram' ? styles.presetChannelIg : styles.presetChannelWpp}`}>
                    {p.channel === 'instagram' ? 'IG' : 'WPP'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.sectionLabel}>Personalizado</div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Contact ID</label>
              <input
                className={styles.fieldInput}
                value={contactId}
                onChange={e => setContactId(e.target.value)}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Nombre</label>
              <input
                className={styles.fieldInput}
                value={contactName}
                onChange={e => setContactName(e.target.value)}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Canal</label>
              <select
                className={styles.fieldInput}
                value={channel}
                onChange={e => setChannel(e.target.value)}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
          </div>

          {/* Customer profile */}
          {customer && (
            <div className={styles.panelSection}>
              <div className={styles.sectionLabel}>Perfil del cliente</div>
              <div className={styles.profileCard}>
                {customer.contactName && (
                  <div className={styles.profileRow}>
                    <span className={styles.profileKey}>Nombre</span>
                    <span className={styles.profileVal}>{customer.contactName}</span>
                  </div>
                )}
                <div className={styles.profileRow}>
                  <span className={styles.profileKey}>Canal</span>
                  <span className={styles.profileVal}>{customer.channel}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat */}
        <div className={styles.chat}>
          <div className={styles.chatHeader}>
            <div className={styles.chatHeaderInfo}>
              <span className={styles.chatName}>{contactName || contactId}</span>
              <span className={`${styles.chatChannel} ${channel === 'instagram' ? styles.chatChannelIg : styles.chatChannelWpp}`}>
                {channel === 'instagram' ? 'Instagram' : 'WhatsApp'}
              </span>
            </div>
            <span className={styles.chatId}>{contactId}</span>
          </div>

          <div className={styles.messages}>
            {messages.length === 0 && !sending && (
              <div className={styles.empty}>Escribí un mensaje para comenzar la simulación</div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : m.role === 'admin' ? styles.bubbleAdmin : styles.bubbleBot}`}
              >
                {m.role !== 'user' && (
                  <span className={styles.bubbleLabel}>
                    {m.role === 'admin' ? 'Agente' : 'Bot'}
                  </span>
                )}
                <div className={styles.bubbleText}>{m.content}</div>
                <div className={styles.bubbleTime}>{formatTime(m.createdAt)}</div>
              </div>
            ))}
            {sending && (
              <div className={`${styles.bubble} ${styles.bubbleBot}`}>
                <span className={styles.bubbleLabel}>Bot</span>
                <div className={styles.typing}>
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && <div className={styles.errorBar}>{error}</div>}

          <form className={styles.inputRow} onSubmit={sendMessage}>
            <textarea
              className={styles.textarea}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribí el mensaje del cliente..."
              rows={2}
              disabled={sending}
            />
            <button className={styles.sendBtn} type="submit" disabled={!input.trim() || sending}>
              Enviar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
