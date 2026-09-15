import { Router } from 'express';
import { processIncomingMessage } from '../services/bot.service.js';
import { getConversationHistory } from '../services/conversation.service.js';
import { getCustomerProfile } from '../services/customer.service.js';

const router = Router();

router.post('/message', async (req, res) => {
  const { contactId, message, channel = 'whatsapp', contactName, type } = req.body;

  if (!contactId || !message) {
    return res.status(400).json({ error: 'contactId y message son requeridos' });
  }

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

export default router;
