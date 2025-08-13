// Minimal OpenAI client using built-in fetch (Node 18+).
// Exports: callOpenAI(prompt) -> returns assistant string.
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function callOpenAI(prompt) {
  try {
    if (!API_KEY) {
      return "**Explication synthétique**\n\nAnalyse IA indisponible (clé OpenAI absente).\n\n**Pourquoi ?**\n- Fournir OPENAI_API_KEY.\n\n**Mesures palliatives**\n- Utiliser la synthèse locale.\n\n**Mesures préventives**\n- Configurer la clé et le modèle.\n\n**Catégorie requise (estimée)**\n- À confirmer après activation IA.";
    }
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'Tu es un assistant ATEX. Réponds en français, avec titres en gras et listes lisibles.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });
    const j = await r.json();
    return j.choices?.[0]?.message?.content || 'Réponse IA indisponible.';
  } catch (e) {
    console.error('[openai] error', e);
    return 'Réponse IA indisponible pour le moment.';
  }
}

module.exports = { callOpenAI };
