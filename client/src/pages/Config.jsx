import { useEffect, useState } from 'react';
import { authFetch, BASE_URL } from '../lib/api';
import styles from './Config.module.css';

const DAYS_ES = {
  monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles',
  thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo',
};

export default function Config() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await authFetch(BASE_URL + '/api/config');
      const data = await res.json();
      setConfig(data.config);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await authFetch(BASE_URL + '/api/config', {
        method: 'PUT',
        body: config,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  function setScheduleDay(day, field, value) {
    setConfig((prev) => ({
      ...prev,
      businessHours: {
        ...prev.businessHours,
        schedule: {
          ...prev.businessHours.schedule,
          [day]: { ...prev.businessHours.schedule[day], [field]: value },
        },
      },
    }));
  }

  if (loading || !config) return <div className={styles.loading}>Cargando...</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Configuración</h1>
          <p className={styles.subtitle}>Personalizá el comportamiento del bot</p>
        </div>
      </header>

      <form onSubmit={handleSave} className={styles.form}>
        {/* Mensajes */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Mensajes del bot</h2>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.label}>Nombre del bot</label>
              <input
                className={styles.input}
                value={config.botName}
                onChange={(e) => setConfig({ ...config, botName: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Personalidad del bot</label>
              <textarea
                className={styles.textarea}
                value={config.botPersonality ?? ''}
                onChange={(e) => setConfig({ ...config, botPersonality: e.target.value })}
                rows={6}
                placeholder="Describí cómo debe comportarse el bot: tono, estilo, qué puede y no puede decir..."
              />
              <p className={styles.hint}>Define el tono, estilo y límites del bot. Este texto se envía directamente al modelo de IA.</p>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Mensaje de bienvenida</label>
              <textarea
                className={styles.textarea}
                value={config.welcomeMessage}
                onChange={(e) => setConfig({ ...config, welcomeMessage: e.target.value })}
                rows={3}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Mensaje fuera de horario</label>
              <textarea
                className={styles.textarea}
                value={config.offHoursMessage}
                onChange={(e) => setConfig({ ...config, offHoursMessage: e.target.value })}
                rows={3}
              />
            </div>
          </div>
        </section>

        {/* Canales */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Canales activos</h2>
          <div className={styles.toggleRow}>
            <ToggleField
              label="WhatsApp"
              badge="whatsapp"
              checked={config.channels.whatsapp}
              onChange={(v) => setConfig({ ...config, channels: { ...config.channels, whatsapp: v } })}
            />
            <ToggleField
              label="Instagram"
              badge="instagram"
              checked={config.channels.instagram}
              onChange={(v) => setConfig({ ...config, channels: { ...config.channels, instagram: v } })}
            />
          </div>
        </section>

        {/* Horarios */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Horarios de atención</h2>
            <ToggleField
              label="Activar horarios"
              checked={config.businessHours.enabled}
              onChange={(v) => setConfig({ ...config, businessHours: { ...config.businessHours, enabled: v } })}
            />
          </div>

          {config.businessHours.enabled && (
            <div className={styles.schedule}>
              {Object.entries(config.businessHours.schedule).map(([day, val]) => (
                <div key={day} className={styles.scheduleRow}>
                  <div className={styles.scheduleDay}>
                    <input
                      type="checkbox"
                      id={day}
                      checked={val.active}
                      onChange={(e) => setScheduleDay(day, 'active', e.target.checked)}
                      className={styles.checkbox}
                    />
                    <label htmlFor={day} className={styles.scheduleDayLabel}>
                      {DAYS_ES[day]}
                    </label>
                  </div>
                  {val.active ? (
                    <div className={styles.scheduleTimes}>
                      <input
                        type="time"
                        className={styles.timeInput}
                        value={val.open ?? '09:00'}
                        onChange={(e) => setScheduleDay(day, 'open', e.target.value)}
                      />
                      <span className={styles.timeSep}>–</span>
                      <input
                        type="time"
                        className={styles.timeInput}
                        value={val.close ?? '18:00'}
                        onChange={(e) => setScheduleDay(day, 'close', e.target.value)}
                      />
                    </div>
                  ) : (
                    <span className={styles.scheduleOff}>Cerrado</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className={styles.formFooter}>
          {saved && <span className={styles.savedMsg}>✓ Cambios guardados</span>}
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ToggleField({ label, checked, onChange, badge }) {
  return (
    <label className={styles.toggle}>
      <div
        className={`${styles.toggleSwitch} ${checked ? styles.toggleSwitchOn : ''}`}
        onClick={() => onChange(!checked)}
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onChange(!checked)}
      >
        <div className={styles.toggleThumb} />
      </div>
      <span className={styles.toggleLabel}>{label}</span>
    </label>
  );
}
