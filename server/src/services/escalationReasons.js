// Motivos de derivación a humano. Los del bot los elige Claude con el
// marcador [MOTIVO:categoria|detalle]; los "equipo_*" los pone el panel
// cuando es el equipo el que toma o arranca la charla.
export const BOT_REASONS = {
  pedido_envio:      'Estado, demora o problema con un pedido o un envío',
  cambio_devolucion: 'Cambio, devolución o garantía',
  pago:              'Problema con un pago, una factura o un cupón',
  producto_stock:    'Stock, talle o detalle de un producto que no pudo confirmar',
  mayorista:         'Compra mayorista, de empresa o pedido especial',
  reclamo:           'Reclamo o cliente enojado',
  propuesta:         'Proveedor, prensa, empleo o alianza comercial',
  sin_info:          'No tiene la información en la base de conocimiento',
  pide_humano:       'El cliente pidió hablar con una persona',
  otro:              'Otro motivo',
};

export const TEAM_REASONS = {
  equipo_inicio: 'El equipo arrancó o retomó la charla (plantilla o mensaje)',
  equipo_toma:   'Un agente tomó la charla o la derivó a mano',
};

export const ESCALATION_REASONS = { ...BOT_REASONS, ...TEAM_REASONS };

const MARKER = /\[MOTIVO:\s*([a-z_]+)\s*(?:\|([^\]\n]*))?\]/i;

/** Saca el marcador del texto. Sin marcador (o categoría desconocida) = 'otro'. */
export function parseReasonMarker(text) {
  const m = MARKER.exec(text);
  if (!m) return { reason: null, detail: null, cleanText: text };
  const key = m[1].toLowerCase();
  const cleanText = text.replace(/^[^\n]*\[MOTIVO:[^\]]*\][^\n]*\n?/mi, (line) => {
    const rest = line.replace(MARKER, '').trim();
    return rest ? rest + '\n' : '';
  }).trim();
  return {
    reason: BOT_REASONS[key] ? key : 'otro',
    detail: (m[2] ?? '').trim().slice(0, 140) || null,
    cleanText,
  };
}

export function reasonPromptLines() {
  return Object.entries(BOT_REASONS).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
}
