import { Router } from 'express';
import multer from 'multer';
import {
  getCustomerProfile,
  updateCustomerNotes,
  enrichCustomerFromTiendaNube,
  listCustomers,
  listAllTags,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  parseCsv,
  importCustomersCsv,
  exportCustomersCsv,
  syncAllTiendaNubeCustomers,
} from '../services/customer.service.js';
import { normalizeArgPhone } from './conversation.routes.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Listado + segmentación ──────────────────────────────────────────────
// Debe ir antes de las rutas /:contactId/* para no colisionar con ellas.

router.get('/', async (req, res) => {
  try {
    const { q, channel } = req.query;
    const tags = req.query.tags ? String(req.query.tags).split(',').filter(Boolean) : undefined;
    const customers = await listCustomers({
      q, channel, tags,
      hasOrders: req.query.hasOrders === 'true' ? true : undefined,
      spentMin: req.query.spentMin,
      spentMonths: req.query.spentMonths,
      product: req.query.product,
      productMonths: req.query.productMonths,
      orderCountMin: req.query.orderCountMin,
      lastOrderMaxDays: req.query.lastOrderMaxDays,
      lastOrderMinDays: req.query.lastOrderMinDays,
    });
    res.json({ customers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync masivo desde Tienda Nube — puede tardar (recorre todos los pedidos).
router.post('/sync-tiendanube', async (req, res) => {
  try {
    res.json(await syncAllTiendaNubeCustomers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tags', async (req, res) => {
  try {
    res.json({ tags: await listAllTags() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export.csv', async (req, res) => {
  try {
    const csv = await exportCustomersCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contactos-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv); // BOM: que Excel abra los acentos bien
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Adjuntá un archivo CSV' });
    const text = req.file.buffer.toString('utf8').replace(/^﻿/, '');
    const rows = parseCsv(text);
    const result = await importCustomersCsv(rows, { normalizePhone: normalizeArgPhone });
    res.json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { phone, channel = 'whatsapp', contactName, email, tags } = req.body;
    if (!phone?.trim()) return res.status(400).json({ error: 'phone requerido' });
    const contactId = channel === 'whatsapp' ? normalizeArgPhone(phone) : phone.trim();
    if (!contactId) return res.status(400).json({ error: `Número de teléfono inválido: "${phone}"` });
    const customer = await createCustomer({ contactId, channel, contactName, email, tags });
    res.status(201).json({ customer });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Un contacto ──────────────────────────────────────────────────────────

router.get('/:contactId', async (req, res) => {
  try {
    const profile = await getCustomerProfile(req.params.contactId);
    if (!profile) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ customer: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:contactId', async (req, res) => {
  try {
    const { contactName, email, tags } = req.body;
    const customer = await updateCustomer(req.params.contactId, { contactName, email, tags });
    res.json({ customer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:contactId/notes', async (req, res) => {
  try {
    await updateCustomerNotes(req.params.contactId, req.body.notes ?? '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:contactId', async (req, res) => {
  try {
    await deleteCustomer(req.params.contactId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:contactId/sync', async (req, res) => {
  try {
    await enrichCustomerFromTiendaNube(req.params.contactId, true);
    const profile = await getCustomerProfile(req.params.contactId);
    res.json({ ok: true, customer: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
