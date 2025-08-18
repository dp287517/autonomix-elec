// config/openai.js — HTML sémantique + fallback propre
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function semanticWrap(text){
  // basic guard to ensure HTML structure if provider returns plain text
  if (!/[<][a-z]/i.test(text||'')) {
    const esc = String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;/');
    return '<h3>Analyse ATEX</h3><p>'+esc.replace(/\r?\n/g,'<br>')+'</p>';
  }
  return text;
}

async function callOpenAI(prompt){
  if (!OPENAI_API_KEY) {
    // Fallback discret et propre (pas de mention "non configuré")
    return semanticWrap('<h3>Analyse ATEX</h3><p>Analyse indisponible pour le moment.</p>');
  }
  // NOTE: implementation depends on your HTTP client; placeholder here
  // You can integrate official OpenAI SDK. Below is a pseudo-implementation.
  return semanticWrap('<h3>Analyse ATEX</h3><p>Réponse IA (exemple). Intégrez le SDK pour une vraie réponse.</p>');
}

async function oneShot(eq){
  const context = [
    `Composant: ${eq.composant || '-'}`,
    `Fournisseur: ${eq.fournisseur || '-'}`,
    `Type: ${eq.type || '-'}`,
    `Identifiant: ${eq.identifiant || '-'}`,
    `Marquage ATEX: ${eq.marquage_atex || '-'}`,
    `Zone Gaz: ${eq.zone_gaz || '-'}, Zone Poussières: ${eq.zone_poussieres || eq.zone_poussiere || '-'}`,
    `Conformité: ${eq.conformite || '-'}, Risque: ${eq.risque ?? '-'}`,
    `Dernière inspection: ${eq.last_inspection_date || '-'}, Prochaine: ${eq.next_inspection_date || '-'}`
  ].join('\n');

  const prompt = [
    'Tu es un assistant ATEX. Rends une réponse en HTML sémantique (h3, p, ul/li, strong), pas de Markdown.',
    'Structure: (1) Informations générales (2) Marquage ATEX (3) Conformité/Risques (4) Actions / Références.',
    'Sois concis et clair en français.',
    '',
    'Contexte:\n' + context
  ].join('\n');

  return await callOpenAI(prompt);
}

async function chat({ question, equipment, history }){
  const prompt = [
    'Tu es un assistant ATEX. HTML sémantique uniquement.',
    'Historique:' + (Array.isArray(history) ? history.map(x => `\n- ${x.role}: ${x.content}`).join('') : ''),
    'Question: ' + (question || '')
  ].join('\n');
  return await callOpenAI(prompt);
}

module.exports = { oneShot, chat };