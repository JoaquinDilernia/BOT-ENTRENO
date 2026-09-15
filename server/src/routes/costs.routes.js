import { Router } from 'express';
import axios from 'axios';
import { getDb } from '../services/firebase.service.js';

const router = Router();
const META_API = 'https://graph.facebook.com/v20.0';
const RAILWAY_FIXED = { min: 5, max: 10 };

// GET /api/costs?month=2025-06  (defaults to current month)
router.get('/', async (req, res) => {
  try {
    const { month } = req.query;
    const { start, end, label } = parsePeriod(month);

    const [claudeData, metaData] = await Promise.all([
      getClaudeCosts(start, end),
      getMetaCosts(start, end),
    ]);

    res.json({
      period: label,
      claude: claudeData,
      meta: metaData,
      railway: RAILWAY_FIXED,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parsePeriod(monthStr) {
  const now = new Date();
  let year, month;
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    [year, month] = monthStr.split('-').map(Number);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const start = new Date(year, month - 1, 1, 0, 0, 0);
  const end   = new Date(year, month,     0, 23, 59, 59);
  const label = `${year}-${String(month).padStart(2, '0')}`;
  return { start, end, label };
}

async function getClaudeCosts(start, end) {
  const db = getDb();
  // Range-only query avoids needing a composite (service, createdAt) index
  const snap = await db.collection('bot-entreno_usage_logs')
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .get();

  let inputTokens = 0, outputTokens = 0, costUSD = 0, callCount = 0;
  const byType = {};

  snap.forEach(doc => {
    const d = doc.data();
    if (d.service !== 'claude') return; // filter in memory
    inputTokens += d.inputTokens ?? 0;
    outputTokens += d.outputTokens ?? 0;
    costUSD += d.costUSD ?? 0;
    callCount++;
    byType[d.type] = (byType[d.type] ?? 0) + 1;
  });

  return {
    inputTokens,
    outputTokens,
    costUSD: Math.round(costUSD * 10000) / 10000,
    callCount,
    byType,
  };
}

async function getMetaCosts(start, end) {
  const wabaId = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token  = process.env.META_ACCESS_TOKEN;

  if (!wabaId || !token) {
    return { available: false, reason: 'META_WHATSAPP_BUSINESS_ACCOUNT_ID no configurado en Railway' };
  }

  try {
    const { data } = await axios.get(`${META_API}/${wabaId}/conversation_analytics`, {
      params: {
        start: Math.floor(start.getTime() / 1000),
        end:   Math.floor(end.getTime()   / 1000),
        granularity: 'MONTHLY',
        'dimensions[]': ['conversation_category', 'conversation_type'],
        access_token: token,
      },
    });

    const points = data?.data?.[0]?.data_points ?? [];
    let totalConversations = 0, totalCostUSD = 0;
    const breakdown = {};

    for (const p of points) {
      totalConversations += p.conversation ?? 0;
      totalCostUSD += p.cost ?? 0;
      const key = p.conversation_type ?? p.conversation_category ?? 'other';
      if (!breakdown[key]) breakdown[key] = { conversations: 0, costUSD: 0 };
      breakdown[key].conversations += p.conversation ?? 0;
      breakdown[key].costUSD += p.cost ?? 0;
    }

    return {
      available: true,
      totalConversations,
      costUSD: Math.round(totalCostUSD * 10000) / 10000,
      breakdown,
    };
  } catch (err) {
    const detail = err.response?.data?.error?.message ?? err.message;
    return { available: false, reason: detail };
  }
}

export default router;
