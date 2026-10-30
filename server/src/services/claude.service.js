import { reasonPromptLines } from './escalationReasons.js';
import { historyToMessages, AGENT_PREFIX } from './historyMessages.js';
import https from 'https';
import { getDb } from './firebase.service.js';

const MODEL = 'claude-sonnet-5';
// Caché de prompt: escribir cuesta 1.25x la entrada (TTL 5 min), leer 0.1x.
const PRICING = { inputPerMTok: 2.00, outputPerMTok: 10.00, cacheWritePerMTok: 2.50, cacheReadPerMTok: 0.20 };

function logUsage(usage, type) {
  if (!usage?.input_tokens && !usage?.cache_read_input_tokens) return;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const costUSD =
    (usage.input_tokens / 1e6) * PRICING.inputPerMTok +
    (cacheWrite / 1e6) * PRICING.cacheWritePerMTok +
    (cacheRead / 1e6) * PRICING.cacheReadPerMTok +
    (usage.output_tokens / 1e6) * PRICING.outputPerMTok;
  getDb().collection('bot-entreno_usage_logs').add({
    service: 'claude',
    model: MODEL,
    inputTokens: usage.input_tokens, // sólo la parte NO cacheada
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
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

IMPORTANTE — MOTIVO DE LA DERIVACIÓN: Cada vez que derivás, agregá también en una línea separada [MOTIVO:categoria|detalle], donde detalle es una frase corta (máx. 12 palabras) y categoria es una de estas:
${reasonPromptLines()}
Ejemplo: "[MOTIVO:pedido_envio|el pedido 1234 no llegó y pasaron 10 días]". El cliente no lo ve.

IMPORTANTE — CIERRE: Si la consulta está completamente resuelta y el cliente se despidió, empezá tu respuesta con [CERRAR]. Si tu respuesta termina con una pregunta, NO uses [CERRAR] — estás esperando que el cliente conteste.
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

IMPORTANTE — MOTIVO DE LA DERIVACIÓN: Cada vez que derivás, agregá también en una línea separada [MOTIVO:categoria|detalle], donde detalle es una frase corta (máx. 12 palabras) y categoria es una de estas:
${reasonPromptLines()}
Ejemplo: "[MOTIVO:pedido_envio|el pedido 1234 no llegó y pasaron 10 días]". El cliente no lo ve.

IMPORTANTE — CIERRE: Si la consulta está completamente resuelta y el cliente se despidió, empezá tu respuesta con [CERRAR].
Ejemplo: "[CERRAR] ¡Con mucho gusto! Si necesitás algo más, escribinos cuando quieras."
Usá [CERRAR] solo cuando estés seguro de que la conversación terminó. Si tu respuesta termina con una pregunta ("¿Te ayudo con algo más?", "¿buscás algo específico?"), NO uses [CERRAR] — estás esperando que el cliente conteste.`;
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
    knowledgeBase = '', orderInfo = null, orderRef = null, orderFromCache = false, stockInfo = null, productInfo = null,
    customerContext = null, availableLabels = [], customerTags = [], botConfig = {}, imageData = null, areas = [],
    tools = [], runTool = null,
  } = context;

  const systemContent = buildSystemPrompt(botConfig, knowledgeBase, orderInfo, orderRef, stockInfo, productInfo, customerContext, availableLabels, areas, customerTags, tools.length > 0, orderFromCache);
  const messages = buildMessages(conversationHistory, userMessage, imageData);

  // Loop de tool-use (mismo patrón que Selvaggio): mientras Claude pida tools,
  // se ejecutan y se le devuelven los resultados. El turno del asistente se
  // reenvía con su `content` COMPLETO (incluidos los bloques thinking) y todos
  // los tool_result van juntos en un único mensaje de usuario.
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAnthropicAPI({
      model: MODEL,
      max_tokens: 2048,
      system: systemContent,
      messages,
      ...(tools.length && { tools }),
    });
    logUsage(response.usage, round === 0 ? 'bot_reply' : 'bot_reply_tool');

    if (response.stop_reason !== 'tool_use' || !runTool) return extractText(response);

    const calls = response.content.filter(b => b.type === 'tool_use');
    const results = await Promise.all(calls.map(async (call) => {
      let output;
      try {
        output = await runTool(call.name, call.input ?? {});
      } catch (err) {
        output = { error: err.message };
      }
      console.log(`[claude] tool ${call.name}`, JSON.stringify(call.input), '→', JSON.stringify(output).slice(0, 300));
      return {
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(output),
        ...(output?.error && { is_error: true }),
      };
    }));
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });
  }

  console.warn('[claude] Se alcanzó el máximo de rondas de tools sin respuesta final');
  return 'Perdón, se me complicó revisar eso. ¿Me lo repetís o preferís que te pase con alguien del equipo?';
}

const MAX_TOOL_ROUNDS = 4;

function buildSystemPrompt(botConfig = {}, knowledgeBase, orderInfo, orderRef, stockInfo, productInfo, customerContext, availableLabels = [], areas = [], customerTags = [], hasProductTool = false, orderFromCache = false) {
  const botName = botConfig.botName || 'Entreno';
  const businessName = botConfig.businessName || 'Entreno';
  const personality = botConfig.botPersonality ||
    `Sos el asistente virtual de Entreno (entreno.com.ar), tienda online de suplementos deportivos, nutrición y indumentaria fitness.
Tenés una onda cercana y motivadora, como alguien del equipo que también entrena. Vas al grano.
Usás español rioplatense (vos, etc.) con calidez y profesionalismo. Nunca sonás robótico ni genérico.
Si no sabés algo, lo decís honestamente y ofrecés derivar a la persona correcta.
Nunca inventás información sobre productos, precios, stock, pedidos, envíos o marcas — solo usás los datos que te den. Si algo no está en la información que tenés, lo decís honestamente en vez de inventar o suponer.`;

  let prompt = `Sos el asistente virtual de ${businessName}. Tu nombre es ${botName}.\n${personality}`;
  // Fuera de `personality` a propósito: botPersonality se puede pisar desde
  // el panel y estas reglas tienen que valer siempre.
  prompt += `\n\nREGLA — SOLO ASISTÍS, NO VENDÉS: Por este chat no se vende, no se reservan ni se apartan productos y no se toman pedidos. Las compras se hacen únicamente en la web (entreno.com.ar). Nunca ofrezcas reservar, separar, guardar o "anotar" un producto, ni tomar un pedido por acá — si el cliente quiere comprar, mandale el link del producto o, si tenés la herramienta armar_carrito, el link del carrito armado: la compra igual la termina él en la web.`;
  prompt += `\n\nFORMATO: Escribís para WhatsApp. Para negrita usá UN solo asterisco (*así*), nunca dos (**así**) — no uses títulos con # ni otro markdown.`;
  prompt += buildEscalationInstructions(areas);
  prompt += `\n\nIMPORTANTE — MENSAJES DEL EQUIPO: Los mensajes que empiezan con "${AGENT_PREFIX}" los escribió alguien del equipo, no vos. Tomá lo que dicen como hecho (si dicen que ya resolvieron algo, está resuelto). Si el cliente solo agradece o confirma algo que el equipo ya resolvió, no vuelvas a derivar: respondé corto y cerrá con [CERRAR]. Nunca repitas ese prefijo en tu respuesta.`;
  if (knowledgeBase) {
    prompt += `\n\n--- INFORMACIÓN DE LA EMPRESA ---\n${knowledgeBase}`;
    prompt += `\n\nIMPORTANTE — USO DE ESTA INFORMACIÓN: Es TU ÚNICA fuente de verdad sobre servicios, precios, procesos y políticas. Antes de responder CUALQUIER consulta, revisá esta sección completa primero. Si algo aplica, compartilo directamente aunque el cliente no lo pida explícitamente. Si la consulta no está cubierta acá, NUNCA inventes ni supongas una respuesta — decí que no tenés esa info y dale lo más útil que tengas (un link, dónde verlo en la web). Derivá solo si el cliente quiere hablar con alguien o si hace falta que el equipo haga algo.
Los items marcados con 🔥 son promociones u ofertas vigentes que queremos impulsar activamente: mencionalas cuando el cliente hable de productos, precios, o esté evaluando una compra, aunque no pregunte por la promo puntualmente. No hace falta que el tema calce exacto — la idea es aprovechar la oportunidad de venta. Eso sí, no la repitas en cada mensaje: si ya la mencionaste en esta conversación, no la vuelvas a meter salvo que el cliente pregunte de nuevo por ella.`;
  }
  // Caché de prompt: `prompt` junta lo que es IGUAL para todos los clientes y
  // va en un bloque cacheado (~10% del costo); `dyn` junta lo que cambia por
  // cliente/mensaje (perfil, pedido, stock, ficha) y va al final, sin caché.
  // No meter nada variable en `prompt`: rompe el caché para todos.
  let dyn = '';
  if (customerContext) dyn += `\n\n--- PERFIL DEL CONTACTO ---\n${customerContext}`;

  prompt += `\n\nREGLA CRÍTICA SOBRE PEDIDOS: NUNCA inventes, sugieras ni adivines números de pedido, fechas, productos o clientes. Toda la información de pedidos que compartís tiene que venir EXCLUSIVAMENTE de la sección "INFORMACIÓN DEL PEDIDO CONSULTADO" de este prompt — si esa sección no está presente, es porque no hay datos reales, y ahí no podés afirmar ni sugerir que encontraste un pedido, aunque el número se parezca a algo mencionado antes. Si el cliente menciona un pedido/compra y no tenés información del pedido en este prompt, pedile el número de pedido (puede mandarlo con o sin "#", solo el número alcanza) para buscarlo. Si no lo tiene a mano o ya lo buscaste y no apareció, como último recurso pedile el email con el que compró.`;
  if (orderInfo) {
    dyn += `\n\n--- INFORMACIÓN DEL PEDIDO CONSULTADO ---\n${JSON.stringify(orderInfo, null, 2)}`;
    dyn += orderFromCache
      ? `\n\nEste es el pedido del que se viene hablando en esta conversación (consultado en Tienda Nube hace un rato). Seguí usándolo con normalidad: no te desdigas de lo que ya le informaste al cliente.`
      : `\n\nEsta información se acaba de consultar en este mismo turno y es la más actualizada que existe. Si en mensajes anteriores dijiste que no encontrabas el pedido, ESO YA NO APLICA — ahora sí lo tenés, usalo con normalidad.`;
    dyn += `\n\nGuía para interpretar el pedido:
- pago "pagado" + envio "enviado" → en camino, compartí el tracking si hay.
- pago "pagado" + envio "en preparación" o "pendiente de preparación" → se está preparando, próximamente se envía.
- pago "pagado" + envio "entregado" → ya fue entregado.
- pago "pendiente de pago" → falta confirmar el pago.
- estado "cancelado" → pedido cancelado, derivar si preguntan por reembolso.
- tipoEntrega "retiro" → el cliente retira el pedido, no aplica tracking de courier.
- Si hay tracking, compartilo directamente sin que lo pida.
- Si hay nota en el pedido, tenerla en cuenta para dar contexto.`;
  } else if (orderRef) {
    dyn += `\n\n--- BÚSQUEDA DE PEDIDO "#${orderRef}" ---\nSe intentó buscar este pedido en Tienda Nube AHORA MISMO y NO se encontró ningún resultado. No existe. No inventes un número, fecha, cliente o producto alternativo por más que "te suene" a algo — decile honestamente al cliente que no lo encontraste. Pedile que confirme bien el número de pedido, o como alternativa el email con el que compró.`;
  }
  if (stockInfo) {
    dyn += `\n\n--- PRECIO Y STOCK DEL PRODUCTO ---\n${stockInfo}`;
    dyn += `\n\nGuía para responder con esta información:
- El precio SÍ se comparte tal cual figura acá (incluido el precio con descuento si aparece "antes $X"). Nunca lo inventes ni lo redondees.
- Si aparecen varios productos, elegí los relevantes a la consulta del cliente — no hace falta leerle los 8 si preguntó por uno puntual.
- "Disponible" → hay stock.
- "Quedan pocas unidades" → puede agotarse pronto, avisale al cliente.
- "Sin stock" → no disponible al momento de la consulta.
- Nunca menciones cantidades numéricas — solo usás las etiquetas anteriores.
- Siempre agregá el disclaimer: "El stock puede variar por las ventas de la tienda."`;
  }
  if (hasProductTool) {
    prompt += `\n\n--- BUSCAR PRODUCTOS (precio y stock) ---
Tenés la herramienta buscar_productos, que consulta el catálogo de la tienda online EN VIVO (precio y stock por variante).
- Usala SIEMPRE que el cliente pregunte por stock, precio o disponibilidad de un producto y ese producto puntual NO esté en "PRECIO Y STOCK DEL PRODUCTO" (esa sección se arma solo con el último mensaje y puede traer productos que no tienen nada que ver).
- Armá la consulta con TODO el contexto de la charla: marca + tipo de producto + tamaño, aunque cada dato lo haya dicho en un mensaje distinto (ej: dijo "quiero creatina star" y después "tienen stock? 300 gr" → consulta "star creatina 300").
- Corregí errores de tipeo obvios (ej: "creativa" → "creatina").
- Si no encuentra nada, probá una vez con menos palabras (ej: solo marca + tipo) antes de decir que no lo tenés.
- Nunca digas que no tenés el dato de stock sin haber usado la herramienta.
- Las mismas reglas de arriba aplican al resultado: etiquetas (Disponible / Quedan pocas unidades / Sin stock), nunca cantidades, precio tal cual figura.

--- LINKS Y CARRITO ---
- Cada producto trae "Link:" — cuando recomendás o informás un producto puntual, pasá su link tal cual (nunca lo inventes ni lo armes vos). Si son varios productos en una lista, un link por producto.
- [producto_id …] y [variante_id …] son de uso interno: nunca se los muestres al cliente.
- Si el cliente quiere comprar, pide "el link para comprar", o le armaste una selección/combo y está de acuerdo, usá armar_carrito con TODOS los productos juntos y mandale ese único link.
- Antes de armar el carrito confirmá la variante (sabor/tamaño) de cada producto que tenga más de una, y la cantidad si no es 1. Solo variantes con stock.
- Al mandar el link del carrito: listá lo que lleva, y avisale que al abrirlo ponga su código postal para calcular el envío y elegir cómo recibirlo antes de pagar. Ej: "Te dejo el carrito armado 👉 <link>" y en la línea siguiente "Al abrirlo poné tu código postal para calcular el envío y elegí cómo recibirlo."
- Si armar_carrito devuelve un error (sin stock, etc.), contale al cliente qué pasó con ese producto y ofrecé una alternativa; no mandes un carrito incompleto sin avisar.
- Ojo: cada vez que se abre, el link SUMA sus productos a lo que ya haya en el carrito (abrirlo dos veces duplica las cantidades) y nunca saca nada. Por eso:
  - Si después quiere agregar productos, armá un carrito SOLO con lo nuevo y aclarale que se suma a lo que ya tiene.
  - Si cambia sabor o cantidad, o quiere sacar algo, no mandes otro link: decile que lo ajuste en el carrito (con − / + o el tachito).
  - Si te dice que le aparecen cantidades de más, explicale que es porque abrió el link más de una vez y que lo corrija con − o el tachito.`;
  }
  if (productInfo) {
    dyn += `\n\n--- FICHA DEL PRODUCTO ---\n${productInfo}`;
    dyn += `\n\nUsá esta ficha para responder preguntas sobre el producto (marca, presentación, sabor, uso, etc). Si la descripción no cubre lo que te preguntan, decilo honestamente en vez de inventar.`;
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

  const blocks = [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }];
  if (dyn.trim()) blocks.push({ type: 'text', text: dyn.trim() });
  return blocks;
}

function buildMessages(conversationHistory, newMessage, imageData = null) {
  const messages = historyToMessages(conversationHistory ?? []);
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
