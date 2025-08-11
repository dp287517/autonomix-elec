const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

router.get('/maintenance-org', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const result = await client.query(`
      WITH RECURSIVE org_tree AS (
        SELECT id, label, role, contact, parent_id FROM maintenance_org WHERE parent_id IS NULL
        UNION ALL
        SELECT m.id, m.label, m.role, m.contact, m.parent_id FROM maintenance_org m INNER JOIN org_tree t ON m.parent_id = t.id
      )
      SELECT * FROM org_tree
    `);
    const nodes = result.rows.map(r => ({ id: r.id, label: r.label, role: r.role, contact: r.contact, parent: r.parent_id || null }));
    const edges = nodes.filter(n => n.parent).map(n => ({ from: n.parent, to: n.id }));
    res.json({ data: { nodes, edges } });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la récupération de l’organigramme: ' + e.message }); } finally { if (client) client.release(); }
});

module.exports = router;
