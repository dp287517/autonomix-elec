const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

router.get('/trades', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const result = await pool.query('SELECT * FROM trades ORDER BY trade_date DESC');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la récupération des trades: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/trades', async (req, res) => {
  const { trade_date, investment, profit_loss, current_capital, notes } = req.body;
  let client; try {
    client = await pool.connect();
    if (!trade_date || isNaN(investment) || isNaN(profit_loss) || isNaN(current_capital)) throw new Error('Champs requis invalides');
    const result = await pool.query('INSERT INTO trades (trade_date, investment, profit_loss, current_capital, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [trade_date, investment, profit_loss, current_capital, notes || null]);
    res.json(result.rows[0]);
  } catch (e) { res.status(400).json({ error: 'Erreur lors de l\'ajout du trade: ' + e.message }); } finally { if (client) client.release(); }
});

router.delete('/trades/:id', async (req, res) => {
  const { id } = req.params;
  let client; try {
    client = await pool.connect();
    const result = await pool.query('DELETE FROM trades WHERE id = $1 RETURNING *', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Trade non trouvé' });
    res.json({ message: 'Trade supprimé' });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la suppression du trade: ' + e.message }); } finally { if (client) client.release(); }
});

module.exports = router;
