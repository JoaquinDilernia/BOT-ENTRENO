import { Router } from 'express';
import { findOrder, searchProducts, getStoreInfo } from '../services/tiendanube.service.js';

const router = Router();

router.get('/order/:query', async (req, res) => {
  try {
    const order = await findOrder(req.params.query);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });
    const products = await searchProducts(q);
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/store', async (req, res) => {
  try {
    const store = await getStoreInfo();
    res.json({ store });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
