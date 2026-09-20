import { Router } from 'express';
import { processIncomingMessage } from '../services/bot.service.js';
import { getConversationHistory, deleteConversation } from '../services/conversation.service.js';
import { getCustomerProfile, deleteCustomer } from '../services/customer.service.js';
import { toWaContactId } from '../services/phone.js';

const router = Router();

// processIncomingMessage canonicaliza el teléfono para WhatsApp antes de
// guardar la conversación (ver bot.service.js) — hay que aplicar la misma
// canonicalización acá o cualquier lectura/borrado por contactId crudo
// apunta a un documento distinto del que realmente se usó.
function canonicalContactId(rawContactId, channel) {
  return channel === 'whatsapp' ? (toWaContactId(rawContactId) ?? rawContactId) : rawContactId;
}

router.post('/message', async (req, res) => {
  const { contactId: rawContactId, message, channel = 'whatsapp', contactName, type } = req.body;

  if (!rawContactId || !message) {
    return res.status(400).json({ error: 'contactId y message son requeridos' });
  }

  const contactId = canonicalContactId(rawContactId, channel);

  try {
    await processIncomingMessage({
      channel,
      from: contactId,
      messageId: null,
      text: message ?? '',
      type: type ?? undefined,
      contactName: contactName ?? `Test-${contactId.slice(-4)}`,
    });

    const [messages, customer] = await Promise.all([
      getConversationHistory(contactId),
      getCustomerProfile(contactId),
    ]);

    const lastBot = [...messages].reverse().find(m => m.role === 'assistant');

    res.json({
      ok: true,
      reply: lastBot?.content ?? null,
      messages: messages.slice(-10),
      customer,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borra la conversación y el perfil simulados para ese contactId, así el
// próximo mensaje arranca de cero (sin historial ni tags/tnOrders viejos).
router.delete('/message', async (req, res) => {
  const { contactId: rawContactId, channel = 'whatsapp' } = req.body;

  if (!rawContactId) {
    return res.status(400).json({ error: 'contactId es requerido' });
  }

  const contactId = canonicalContactId(rawContactId, channel);

  try {
    await Promise.all([
      deleteConversation(contactId),
      deleteCustomer(contactId),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
