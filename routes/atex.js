// routes/atex.js — Version complète, fusionnée avec ton existant et adaptée à la nouvelle DB (atex_secteurs, attachments, ia_history, etc.)
// Inclut tout : secteurs, équipements CRUD, inspections, photo upload, import CSV/XLSX, IA oneShot/chat (persistent par user), viewer /equip/:id

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const { pool } = require('../config/db');
const { oneShot, chat } = require('../config/openai'); // Ton openai.js
const authz = require('../middleware/authz');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helpers
async function roleOnAccount(userId, accountId) {
  const r = await pool.query('SELECT role FROM user_accounts WHERE user_id = $1 AND account_id = $2', [userId, accountId]);
  return r.rows.length ? r.rows[0].role : null;
}

function normStr(v) { return v == null ? null : String(v).trim(); }

function parseMaybeJSON(value) {
  if (value == null) return null;
  if (Array.isArray(value) || typeof value === 'object') return value;
  if (typeof value === 'string' && !value.trim()) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function ensureArray(x) {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  const parsed = parseMaybeJSON(x);
  return Array.isArray(parsed) ? parsed : [];
}

function sanitizeAttachmentItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    const src = item.trim();
    if (!src) return null;
    return { url: src, name: 'Pièce', mime: guessMime(src) };
  }
  const src = item.url || item.href || item.path || item.data || '';
  if (!src) return null;
  return {
    name: item.name || item.label || 'Pièce',
    url: item.url,
    data: item.data,
    mime: item.mime || guessMime(src)
  };
}

function guessMime(src) {
  if (/^data:([^;]+)/i.test(src)) return RegExp.$1;
  if (/\.pdf(\?|$)/i.test(src)) return 'application/pdf';
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(src)) return 'image/' + RegExp.$1.toLowerCase();
  return '';
}

// Secteurs (atex_secteurs)
router.get('/atex-secteurs', authz.requireAuth, async (req, res) => {
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_secteurs WHERE account_id = $1 ORDER BY name', [accountId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET atex-secteurs] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/atex-secteurs', authz.requireAuth, async (req, res) => {
  const { name } = req.body;
  const accountId = req.accountId;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  try {
    const result = await pool.query(
      'INSERT INTO atex_secteurs (name, account_id) VALUES ($1, $2) RETURNING id',
      [name, accountId]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate name in account' });
    console.error('[POST atex-secteurs] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Équipements CRUD
router.get('/atex-equipments', authz.requireAuth, async (req, res) => {
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_equipments WHERE account_id = $1 ORDER BY id', [accountId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET atex-equipments] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/atex-equipments/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_equipments WHERE id = $1 AND account_id = $2', [id, accountId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET atex-equipments/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/atex-equipments', authz.requireAuth, async (req, res) => {
  const equipment = req.body;
  const accountId = req.accountId;
  equipment.attachments = ensureArray(equipment.attachments);
  try {
    const fields = ['account_id', 'secteur_id', 'batiment', 'local', 'composant', 'fabricant', 'type', 'identifiant', 'zone_gaz', 'zone_poussieres', 'marquage_atex', 'photo', 'attachments', 'conformite', 'comments', 'last_inspection_date', 'frequence', 'risk', 'grade'];
    const placeholders = fields.map((_, i) => `$${i+1}`).join(', ');
    const values = fields.map(f => equipment[f] || null);
    values[0] = accountId; // account_id
    const result = await pool.query(
      `INSERT INTO atex_equipments (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('[POST atex-equipments] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/atex-equipments/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const equipment = req.body;
  const accountId = req.accountId;
  equipment.attachments = ensureArray(equipment.attachments);
  try {
    const fields = Object.keys(equipment).map((k, i) => `${k} = $${i+2}`).join(', ');
    const values = Object.values(equipment);
    await pool.query(
      `UPDATE atex_equipments SET ${fields} WHERE id = $1 AND account_id = $${values.length + 1}`,
      [id, ...values, accountId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[PUT atex-equipments/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/atex-equipments/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    await pool.query('DELETE FROM atex_equipments WHERE id = $1 AND account_id = $2', [id, accountId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE atex-equipments/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Photo upload (dataURL base64)
router.post('/atex-photo/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  const { photo } = req.body;
  try {
    await pool.query('UPDATE atex_equipments SET photo = $1 WHERE id = $2 AND account_id = $3', [photo, id, accountId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[POST atex-photo/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Inspections
router.post('/atex-inspections', authz.requireAuth, async (req, res) => {
  const { equipment_id, comments, conformite, attachments } = req.body;
  const accountId = req.accountId;
  try {
    const result = await pool.query(
      'INSERT INTO atex_inspections (equipment_id, comments, conformite, attachments, inspection_date) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
      [equipment_id, comments, conformite, attachments]
    );
    // Update last_inspection_date in equipments
    await pool.query('UPDATE atex_equipments SET last_inspection_date = NOW() WHERE id = $1 AND account_id = $2', [equipment_id, accountId]);
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('[POST atex-inspections] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// IA oneShot
router.get('/atex-help/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_equipments WHERE id = $1 AND account_id = $2', [id, accountId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const equipment = result.rows[0];
    const html = await oneShot(equipment);
    res.json({ html });
  } catch (err) {
    console.error('[GET atex-help/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Chat IA (persistent)
router.post('/atex-chat', authz.requireAuth, async (req, res) => {
  const { question, equipment_id, history } = req.body;
  const accountId = req.accountId;
  const userId = req.user.id;
  try {
    const response = await chat({ question, equipment: { id: equipment_id }, history });
    // Save history to DB
    const newHistory = [...history, { role: 'user', content: question }, { role: 'assistant', content: response }];
    await pool.query(
      'INSERT INTO atex_chat_threads (account_id, equipment_id, user_id, history) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, equipment_id, user_id) DO UPDATE SET history = $4, updated_at = NOW()',
      [accountId, equipment_id, userId, JSON.stringify(newHistory)]
    );
    res.json({ response });
  } catch (err) {
    console.error('[POST atex-chat] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get chat thread
router.get('/atex-chat/:equipment_id', authz.requireAuth, async (req, res) => {
  const equipment_id = req.params.equipment_id;
  const accountId = req.accountId;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT history FROM atex_chat_threads WHERE account_id = $1 AND equipment_id = $2 AND user_id = $3',
      [accountId, equipment_id, userId]
    );
    res.json(result.rows.length ? result.rows[0].history : []);
  } catch (err) {
    console.error('[GET atex-chat/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete chat thread
router.delete('/atex-chat/:equipment_id', authz.requireAuth, async (req, res) => {
  const equipment_id = req.params.equipment_id;
  const accountId = req.accountId;
  const userId = req.user.id;
  try {
    await pool.query(
      'DELETE FROM atex_chat_threads WHERE account_id = $1 AND equipment_id = $2 AND user_id = $3',
      [accountId, equipment_id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE atex-chat/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Import Excel/CSV
router.post('/atex-import-excel', upload.single('file'), authz.requireAuth, async (req, res) => {
  const accountId = req.accountId;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });
  try {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // Process data and insert into DB
    for (const row of data.slice(1)) {
      const equipment = {
        secteur: row[0],
        batiment: row[1],
        local: row[2],
        composant: row[3],
        fabricant: row[4],
        type: row[5],
        identifiant: row[6],
        zone_gaz: row[7],
        zone_poussieres: row[8],
        marquage_atex: row[9],
        last_inspection_date: row[10] ? new Date(row[10]) : null
      };
      await saveEquipment(equipment, accountId); // Function to insert
    }
    res.json({ success: true, count: data.length - 1 });
  } catch (err) {
    console.error('[POST atex-import-excel] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Viewer /equip/:id (photo + attachments)
router.get('/equip/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_equipments WHERE id = $1 AND account_id = $2', [id, accountId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const eq = result.rows[0];
    const items = ensureArray(eq.attachments).map(sanitizeAttachmentItem);
    if (eq.photo) items.unshift({ name: 'Photo', src: eq.photo, mime: 'image/jpeg' });
    res.json({ id: eq.id, items });
  } catch (err) {
    console.error('[GET /equip/:id] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
