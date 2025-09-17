// routes/atex.js — Version complète avec jointure pour secteur
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const { pool } = require('../config/db');
const { oneShot, chat } = require('../config/openai'); // Assumez qu'il existe
const authz = require('../middleware/authz'); // Assumez middleware auth

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

// Secteurs
router.get('/atex-secteurs', authz.requireAuth, async (req, res) => {
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_secteurs WHERE account_id = $1 ORDER BY name', [accountId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET atex-secteurs] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

router.post('/atex-secteurs', authz.requireAuth, async (req, res) => {
  const { name } = req.body;
  const accountId = req.accountId;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
    const result = await pool.query(
      'INSERT INTO atex_secteurs (name, account_id) VALUES ($1, $2) RETURNING id',
      [name, accountId]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nom déjà utilisé dans ce compte' });
    console.error('[POST atex-secteurs] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Équipements CRUD
router.get('/atex-equipments', authz.requireAuth, async (req, res) => {
  const accountId = req.accountId;
  const { secteur_id, conformite, statut } = req.query;
  try {
    let query = `
      SELECT e.*, s.name as secteur_name
      FROM atex_equipments e
      LEFT JOIN atex_secteurs s ON e.secteur_id = s.id
      WHERE e.account_id = $1
    `;
    const params = [accountId];
    if (secteur_id) {
      query += ` AND e.secteur_id = $${params.length + 1}`;
      params.push(secteur_id);
    }
    if (conformite) {
      query += ` AND e.conformite = $${params.length + 1}`;
      params.push(conformite);
    }
    if (statut) {
      // Statut is client-side computed, so we simulate it
      const today = new Date();
      if (statut === 'En retard') {
        query += ` AND e.next_inspection_date < $${params.length + 1}`;
        params.push(today.toISOString());
      } else if (statut === 'Aujourd’hui') {
        query += ` AND e.next_inspection_date >= $${params.length + 1} AND e.next_inspection_date <= $${params.length + 2}`;
        params.push(today.toISOString());
        params.push(new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
      } else if (statut === 'Bientôt') {
        query += ` AND e.next_inspection_date >= $${params.length + 1} AND e.next_inspection_date <= $${params.length + 2}`;
        params.push(today.toISOString());
        params.push(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
      } else if (statut === 'OK') {
        query += ` AND e.next_inspection_date > $${params.length + 1}`;
        params.push(new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
      }
    }
    query += ' ORDER BY e.id';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET atex-equipments] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

router.get('/atex-equipments/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query(
      'SELECT e.*, s.name as secteur_name FROM atex_equipments e LEFT JOIN atex_secteurs s ON e.secteur_id = s.id WHERE e.id = $1 AND e.account_id = $2',
      [id, accountId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET atex-equipments/:id] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

router.post('/atex-equipments', authz.requireAuth, async (req, res) => {
  const equipment = req.body;
  const accountId = req.accountId;
  equipment.attachments = ensureArray(equipment.attachments).map(sanitizeAttachmentItem).filter(Boolean);
  try {
    const fields = ['account_id', 'secteur_id', 'batiment', 'local', 'composant', 'fabricant', 'type', 'identifiant', 'zone_gaz', 'zone_poussieres', 'marquage_atex', 'photo', 'attachments', 'conformite', 'comments', 'last_inspection_date', 'frequence', 'risk', 'grade'];
    const placeholders = fields.map((_, i) => `$${i+1}`).join(', ');
    const values = fields.map(f => equipment[f] || null);
    values[0] = accountId;
    values[12] = JSON.stringify(values[12]);
    const result = await pool.query(
      `INSERT INTO atex_equipments (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('[POST atex-equipments] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

router.put('/atex-equipments/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const equipment = req.body;
  const accountId = req.accountId;
  equipment.attachments = ensureArray(equipment.attachments).map(sanitizeAttachmentItem).filter(Boolean);
  try {
    const fields = ['secteur_id', 'batiment', 'local', 'composant', 'fabricant', 'type', 'identifiant', 'zone_gaz', 'zone_poussieres', 'marquage_atex', 'photo', 'attachments', 'conformite', 'comments', 'last_inspection_date', 'frequence', 'risk', 'grade'];
    const setters = fields.map((f, i) => `${f} = $${i+1}`).join(', ');
    const values = fields.map(f => equipment[f] || null);
    values[11] = JSON.stringify(values[11]);
    values.push(id);
    values.push(accountId);
    const result = await pool.query(
      `UPDATE atex_equipments SET ${setters} WHERE id = $${fields.length + 1} AND account_id = $${fields.length + 2} RETURNING id`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ success: true });
  } catch (err) {
    console.error('[PUT atex-equipments/:id] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

router.delete('/atex-equipments/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query('DELETE FROM atex_equipments WHERE id = $1 AND account_id = $2', [id, accountId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE atex-equipments/:id] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Inspections
router.post('/atex-inspections', authz.requireAuth, async (req, res) => {
  const { equipment_id, conformite, comments, date } = req.body;
  const accountId = req.accountId;
  try {
    const result = await pool.query(
      'UPDATE atex_equipments SET conformite = $1, comments = $2, last_inspection_date = $3 WHERE id = $4 AND account_id = $5',
      [conformite, comments, date, equipment_id, accountId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ success: true });
  } catch (err) {
    console.error('[POST atex-inspections] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// IA oneShot
router.get('/atex-help/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query(
      'SELECT e.*, s.name as secteur_name FROM atex_equipments e LEFT JOIN atex_secteurs s ON e.secteur_id = s.id WHERE e.id = $1 AND e.account_id = $2',
      [id, accountId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    const equipment = result.rows[0];
    const html = await oneShot(equipment); // Assume oneShot returns HTML
    res.json({ html });
  } catch (err) {
    console.error('[GET atex-help/:id] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Chat IA
router.post('/atex-chat', authz.requireAuth, async (req, res) => {
  const { question, equipment_id, history } = req.body;
  const accountId = req.accountId;
  const userId = req.user.id;
  try {
    const response = await chat({ question, equipment: { id: equipment_id }, history });
    const newHistory = [...(history || []), { role: 'user', content: question }, { role: 'assistant', content: response }];
    await pool.query(
      'INSERT INTO atex_chat_threads (account_id, equipment_id, user_id, history) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, equipment_id, user_id) DO UPDATE SET history = $4, updated_at = NOW()',
      [accountId, equipment_id, userId, JSON.stringify(newHistory)]
    );
    res.json({ response });
  } catch (err) {
    console.error('[POST atex-chat] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
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
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
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
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Import Excel/CSV
router.post('/atex-import-excel', upload.single('file'), authz.requireAuth, async (req, res) => {
  const accountId = req.accountId;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Aucun fichier' });
  try {
    let data;
    if (file.originalname.endsWith('.csv')) {
      const csv = file.buffer.toString('utf8');
      data = Papa.parse(csv, { header: false }).data;
    } else {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    }
    let count = 0;
    for (const row of data.slice(1)) {
      if (!row.length) continue;
      const equipment = {
        secteur: normStr(row[0]),
        batiment: normStr(row[1]),
        local: normStr(row[2]),
        composant: normStr(row[3]),
        fabricant: normStr(row[4]),
        type: normStr(row[5]),
        identifiant: normStr(row[6]),
        zone_gaz: normStr(row[7]),
        zone_poussieres: normStr(row[8]),
        marquage_atex: normStr(row[9]),
        last_inspection_date: row[10] ? new Date(row[10]) : null,
        attachments: []
      };
      if (equipment.secteur) {
        const secteurRes = await pool.query('SELECT id FROM atex_secteurs WHERE name = $1 AND account_id = $2', [equipment.secteur, accountId]);
        if (secteurRes.rows.length) {
          equipment.secteur_id = secteurRes.rows[0].id;
        } else {
          const newSect = await pool.query('INSERT INTO atex_secteurs (name, account_id) VALUES ($1, $2) RETURNING id', [equipment.secteur, accountId]);
          equipment.secteur_id = newSect.rows[0].id;
        }
      }
      delete equipment.secteur;
      const fields = ['account_id', 'secteur_id', 'batiment', 'local', 'composant', 'fabricant', 'type', 'identifiant', 'zone_gaz', 'zone_poussieres', 'marquage_atex', 'last_inspection_date', 'attachments'];
      const placeholders = fields.map((_, i) => `$${i+1}`).join(', ');
      const values = fields.map(f => equipment[f] || null);
      values[0] = accountId;
      values[12] = JSON.stringify(values[12]);
      await pool.query(`INSERT INTO atex_equipments (${fields.join(', ')}) VALUES (${placeholders})`, values);
      count++;
    }
    res.json({ success: true, count });
  } catch (err) {
    console.error('[POST atex-import-excel] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Viewer /equip/:id
router.get('/equip/:id', authz.requireAuth, async (req, res) => {
  const id = req.params.id;
  const accountId = req.accountId;
  try {
    const result = await pool.query('SELECT * FROM atex_equipments WHERE id = $1 AND account_id = $2', [id, accountId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    const eq = result.rows[0];
    const items = ensureArray(eq.attachments).map(sanitizeAttachmentItem).filter(Boolean);
    if (eq.photo) items.unshift({ name: 'Photo', src: eq.photo, mime: 'image/jpeg' });
    res.json({ id: eq.id, attachments: items });
  } catch (err) {
    console.error('[GET /equip/:id] error', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

module.exports = router;
