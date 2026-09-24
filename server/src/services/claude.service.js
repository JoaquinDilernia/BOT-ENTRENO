import https from 'https';
import { getDb } from './firebase.service.js';

const MODEL = 'claude-sonnet-5';
const PRICING = { inputPerMTok: 2.00, outputPerMTok: 10.00 };

function logUsage(usage, type) {
  if (!usage?.input_tokens) return;
  const costUSD =
    (usage.input_tokens / 1e6) * PRICING.inputPerMTok +
    (usage.output_tokens / 1e6) * PRICING.outputPerMTok;
  getDb().collection('bot-entreno_usage_logs').add({
    service: 'claude',
    model: MODEL,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUSD: Math.round(costUSD * 1e6) / 1e6,
    type,
    createdAt: new Date(),
  }).catch(err => console.error('[claude] Error logging usage to Firestore:', err.message));
}

function buildEscalationInstructions(areas = []) {
  if (!areas.length) {
    return `
IMPORTANTE — ESCALADA: Si la consulta requiere atención humana y no podés resolverla, usá el marcador [ESCALAR] en una línea separada.

IMPORTANTE — CIERRE: Si la consulta está completamente resuelta, empezá tu respuesta con [CERRAR].
Ejemplo: "[CERRAR] ¡Con mucho gusto! Si necesitás algo más, escribinos cuando quieras."`;
  }

  const lines = areas.map(a => `- [ESCALAR_${a.id.toUpperCase()}] — ${a.description}`).join('\n');

  return `
IMPORTANTE — ESCALADA: Cuando la consulta requiere atención humana, usá UNO de estos marcadores en una línea separada (NUNCA pongas otro texto en esa misma línea):
${lines}

Si la consulta requiere atención humana pero ninguna de las áreas de arriba encaja bien, usá [ESCALAR] sin especificar — no fuerces una de ellas si ninguna es la correcta.

El texto de tu respuesta (antes o después del marcador) es lo que le llega al cliente — avisale que lo derivás y que puede haber una pequeña demora. El marcador es invisible para el cliente.
Ejemplo correcto:
"Dale, te paso con el equipo que te puede ayudar mejor con esto. Puede tardar unos minutos, ¡pero te van a responder enseguida!
[ESCALAR_${areas[0].id.toUpperCase()}]"

IMPORTANTE — CIERRE: Si la consulta está completamente resuelta y el cliente se despidió, empezá tu respuesta con [CERRAR].
Ejemplo: "[CERRAR] ¡Con mucho gusto! Si necesitás algo más, escribinos cuando quieras."
Usá [CERRAR] solo cuando estés seguro de que la conversación terminó.`;
}

// Extrae el texto de la respuesta recorriendo los bloques de `content` en vez
// de asumir que el bloque [0] es siempre de tipo texto — con claude-sonnet-5,
// un system prompt largo (como el de este bot) le hace anteponer un bloque
// `thinking`, y asumir [0] devuelve undefined y tira el bot entero abajo sin
// avisarle nada al cliente (ver incidente BOT-ALTORANCHO 2026-09-01, [[project-bots]]).
function extractText(response) {
  return (response.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
}

function callAnthropicAPIOnce(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          const err = new Error(`Anthropic API ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          err.retryAfter = res.headers['retry-after'];
          return reject(err);
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse Anthropic response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const CLAUDE_MAX_RETRIES = 5;

async function callAnthropicAPI(payload) {
  let lastErr;
  for (let attempt = 1; attempt <= CLAUDE_MAX_RETRIES; attempt++) {
    try {
      return await callAnthropicAPIOnce(payload);
    } catch (err) {
      lastErr = err;
      const retryable = !err.statusCode || err.statusCode === 429 || err.statusCode === 529 || err.statusCode >= 500;
      if (!retryable || attempt === CLAUDE_MAX_RETRIES) throw err;
      const waitMs = err.retryAfter ? parseInt(err.retryAfter, 10) * 1000 : Math.min(1000 * 2 ** (attempt - 1), 15000);
      console.warn(`[claude] Retry ${attempt}/${CLAUDE_MAX_RETRIES} tras error: ${err.message} — esperando ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export async function generateConversationSummary(messages) {
  if (!messages?.length) return 'Sin mensajes para resumir.';
  const formatted = messages
    .map(m => {
      const who = m.role === 'user' ? 'Cliente' : m.role === 'admin' ? 'Agente' : 'Bot';
      return `${who}: ${m.content ?? ''}`;
    })
    .join('\n');

  const response = await callAnthropicAPI({
    model: MODEL,
    max_tokens: 350,
    system: 'Generás resúmenes breves de conversaciones de atención al cliente en español rioplatense. Respondés SOLO con el resumen, sin encabezados ni listas.',
    messages: [{
      role: 'user',
      content: `Generá un resumen de 2 a 4 oraciones de esta conversación. Incluí: el motivo principal de la consulta y cómo terminó (resuelto, derivado a agente, pendiente).\n\nConversación:\n${formatted}`,
    }],
  });
  logUsage(response.usage, 'summary');
  return extractText(response);
}

export async function generateBotResponse(userMessage, conversationHistory, context = {}) {
  const {
    knowledgeBase = '', orderInfo = null, orderRef = null, stockInfo = null, productInfo = null,
    customerContext = null, availableLabels = [], customerTags = [], botConfig = {}, imageData = null, areas = [],
  } = context;

  const systemContent = buildSystemPrompt(botConfig, knowledgeBase, orderInfo, orderRef, stockInfo, productInfo, customerContext, availableLabels, areas, customerTags);
  const messages = buildMessages(conversationHistory, userMessage, imageData);

  const response = await callAnthropicAPI({
    model: MODEL,
    max_tokens: 1024,
    system: systemContent,
    messages,
  });

  logUsage(response.usage, 'bot_reply');
  return extractText(response);
}

function buildSystemPrompt(botConfig = {}, knowledgeBase, orderInfo, orderRef, stockInfo, productInfo, customerContext, availableLabels = [], areas = [], customerTags = []) {
  const botName = botConfig.botName || 'Entreno';
  const businessName = botConfig.businessName || 'Entreno';
  const personality = botConfig.botPersonality ||
    `Sos el asistente virtual de Entreno (entreno.com.ar), tienda online de suplementos deportivos, nutrición y indumentaria fitness.
Tenés una onda cercana y motivadora, como alguien del equipo que también entrena. Vas al grano.
Usás español rioplatense (vos, etc.) con calidez y profesionalismo. Nunca sonás robótico ni genérico.
Si no sabés algo, lo decís honestamente y ofrecés derivar a la persona correcta.
Nunca inventás información sobre productos, precios, stock, pedidos, envíos o marcas — solo usás los datos que te den. Si algo no está en la información que tenés, lo decís honestamente en vez de inventar o suponer.`;

  let prompt = `Sos el asistente virtual de ${businessName}. Tu nombre es ${botName}.\n${personality}`;
  prompt += buildEscalationInstructions(areas);
  if (knowledgeBase) {
    prompt += `\n\n--- INFORMACIÓN DE LA EMPRESA ---\n${knowledgeBase}`;
    prompt += `\n\nIMPORTANTE — USO DE ESTA INFORMACIÓN: Es TU ÚNICA fuente de verdad sobre servicios, precios, procesos y políticas. Antes de responder CUALQUIER consulta, revisá esta sección completa primero. Si algo aplica, compartilo directamente aunque el cliente no lo pida explícitamente. Si la consulta no está cubierta acá, NUNCA inventes ni supongas una respuesta — decí que no tenés esa info y ofrecé derivar a alguien del equipo.`;
  }
  if (customerContext) prompt += `\n\n--- PERFIL DEL CONTACTO ---\n${customerContext}`;

  prompt += `\n\nREGLA CRÍTICA SOBRE PEDIDOS: NUNCA inventes, sugieras ni adivines números de pedido, fechas, productos o clientes. Toda la información de pedidos que compartís tiene que venir EXCLUSIVAMENTE de la sección "INFORMACIÓN DEL PEDIDO CONSULTADO" de este prompt — si esa sección no está presente, es porque no hay datos reales, y ahí no podés afirmar ni sugerir que encontraste un pedido, aunque el número se parezca a algo mencionado antes. Si el cliente menciona un pedido/compra y no tenés información del pedido en este prompt, pedile el número de pedido (puede mandarlo con o sin "#", solo el número alcanza) para buscarlo. Si no lo tiene a mano o ya lo buscaste y no apareció, como último recurso pedile el email con el que compró.`;
  if (orderInfo) {
    prompt += `\n\n--- INFORMACIÓN DEL PEDIDO CONSULTADO ---\n${JSON.stringify(orderInfo, null, 2)}`;
    prompt += `\n\nEsta información se acaba de consultar en este mismo turno y es la más actualizada que existe. Si en mensajes anteriores dijiste que no encontrabas el pedido, ESO YA NO APLICA — ahora sí lo tenés, usalo con normalidad.`;
    prompt += `\n\nGuía para interpretar el pedido:
- pago "pagado" + envio "enviado" → en camino, compartí el tracking si hay.
- pago "pagado" + envio "en preparación" o "pendiente de preparación" → se está preparando, próximamente se envía.
- pago "pagado" + envio "entregado" → ya fue entregado.
- pago "pendiente de pago" → falta confirmar el pago.
- estado "cancelado" → pedido cancelado, derivar si preguntan por reembolso.
- tipoEntrega "retiro" → el cliente retira el pedido, no aplica tracking de courier.
- Si hay tracking, compartilo directamente sin que lo pida.
- Si hay nota en el pedido, tenerla en cuenta para dar contexto.`;
  } else if (orderRef) {
    prompt += `\n\n--- BÚSQUEDA DE PEDIDO "#${orderRef}" ---\nSe intentó buscar este pedido en Tienda Nube AHORA MISMO y NO se encontró ningún resultado. No existe. No inventes un número, fecha, cliente o producto alternativo por más que "te suene" a algo — decile honestamente al cliente que no lo encontraste. Pedile que confirme bien el número de pedido, o como alternativa el email con el que compró.`;
  }
  if (stockInfo) {
    prompt += `\n\n--- PRECIO Y STOCK DEL PRODUCTO ---\n${stockInfo}`;
    prompt += `\n\nGuía para responder con esta información:
- El precio SÍ se comparte tal cual figura acá (incluido el precio con descuento si aparece "antes $X"). Nunca lo inventes ni lo redondees.
- Si aparecen varios productos, elegí los relevantes a la consulta del cliente — no hace falta leerle los 8 si preguntó por uno puntual.
- "Disponible" → hay stock.
- "Quedan pocas unidades" → puede agotarse pronto, avisale al cliente.
- "Sin stock" → no disponible al momento de la consulta.
- Nunca menciones cantidades numéricas — solo usás las etiquetas anteriores.
- Siempre agregá el disclaimer: "El stock puede variar por las ventas de la tienda."`;
  }
  if (productInfo) {
    prompt += `\n\n--- FICHA DEL PRODUCTO ---\n${productInfo}`;
    prompt += `\n\nUsá esta ficha para responder preguntas sobre el producto (marca, presentación, sabor, uso, etc). Si la descripción no cubre lo que te preguntan, decilo honestamente en vez de inventar.`;
  }
  if (availableLabels.length) {
    prompt += `\n\n--- ETIQUETAS ---\nDEBÉS etiquetar SIEMPRE esta conversación con al menos 1 etiqueta usando [LABEL:nombre] en tu respuesta (invisible para el cliente).
Etiquetas disponibles: ${availableLabels.join(', ')}.
Si ninguna aplica, creá una nueva con [NEW_LABEL:nombre] (ej: [NEW_LABEL:Consulta técnica]).
Guía:
- [LABEL:Lead] → interesado nuevo, todavía no es cliente.
- [LABEL:Consulta] → preguntas generales sobre servicios o funcionamiento.
- [LABEL:Soporte] → cliente existente con una duda o problema puntual.
- [LABEL:Reclamo] → queja o insatisfacción.
Podés combinar varias etiquetas si aplica.`;
  }

  // --- Tags de CONTACTO (persisten entre conversaciones, sirven para segmentar
  //     difusiones). A diferencia de las etiquetas de conversación, NO son
  //     obligatorios: solo taggeás si el mensaje da una señal clara.
  {
    const guide = (botConfig.customerTagsGuide || '').trim();
    const existing = (customerTags || []).filter(Boolean);
    prompt += `\n\n--- TAGS DE CONTACTO ---
Si en el mensaje aparece una señal CLARA sobre quién es este cliente, agregale un tag con [TAG:nombre] (invisible para el cliente). NO inventes si no hay señal — es opcional.
Categorías (basadas en el catálogo real de Entreno):
- Interés de producto: Whey Protein, Plant Protein, Creatina, Pre-entreno, BCAA/EAA, Quemadores, Glutamina, Colágeno, Vitaminas, Ropa.
- Objetivo: Ganar masa muscular, Perder grasa, Mejorar entrenamiento, Salud & bienestar, Aumentar energía.
- Comportamiento: Recurrente, Primera compra, Reclamó, Alto gasto.`;
    if (existing.length) prompt += `\nTags que ya se usan (reusá estos si aplican, respetando cómo están escritos): ${existing.join(', ')}.`;
    prompt += `\nSi ninguno encaja y la señal es clara, creá uno con [NEW_TAG:nombre].`;
    if (guide) prompt += `\nGuía del negocio:\n${guide}`;
  }

  return prompt;
}

function buildMessages(conversationHistory, newMessage, imageData = null) {
  const messages = [];
  if (conversationHistory?.length) {
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      messages.push({ role, content: msg.content });
    }
  }
  if (imageData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: imageData.mimeType, data: imageData.base64 } },
        { type: 'text', text: newMessage || 'Describí esta imagen en el contexto de la consulta del cliente.' },
      ],
    });
  } else {
    messages.push({ role: 'user', content: newMessage });
  }
  return messages;
}
