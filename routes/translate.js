const express = require('express');
const router = express.Router();

// Placeholder: DeepL non activé si pas de clé
router.post('/translate', async (req, res) => {
  const { text, targetLang } = req.body;
  try {
    if (!text || !targetLang) throw new Error('Texte et langue cible requis');
    // Mettre ici l'appel à DeepL si besoin.
    return res.status(501).json({ error: 'Service de traduction non configuré (DEEPL_API_KEY manquante).' });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la traduction: ' + e.message }); }
});

module.exports = router;
