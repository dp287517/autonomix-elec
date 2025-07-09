const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Connexion à Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Créer la table des trades si elle n'existe pas
pool.query(`
  CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    trade_date DATE NOT NULL,
    investment DECIMAL NOT NULL,
    profit_loss DECIMAL NOT NULL,
    current_capital DECIMAL NOT NULL,
    notes TEXT
  )
`).catch(err => console.error('Error creating table:', err));

// Routes API
app.get('/trades', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trades ORDER BY trade_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/trades', async (req, res) => {
  const { trade_date, investment, profit_loss, current_capital, notes } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO trades (trade_date, investment, profit_loss, current_capital, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [trade_date, investment, profit_loss, current_capital, notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/trades/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM trades WHERE id = $1', [id]);
    res.json({ message: 'Trade deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
