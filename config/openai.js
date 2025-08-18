// config/openai.js
/**
 * ATEX IA – OpenAI wiring
 * - oneShot(equipment): renvoie un HTML d’analyse
 * - chat({question, equipment, history}): renvoie un HTML de réponse
 *
 * Si OPENAI_API_KEY absent => fallback local (même style que la route).
 */
const { deriveLocal } = (() => {
  // mini moteur local (mêmes règles que côté route)
  function requiredCategoryForZone(zg, zd){
    const zgNum = String(zg||'').replace(/[^0-9]/g,'') || '';
    const zdNum = String(zd||'').replace(/[^0-9]/g,'') || '';
    if(zgNum === '0' || zdNum === '20') return 'II 1GD';
    if(zgNum === '1' || zdNum === '21') return 'II 2GD';
    return 'II 3GD';
  }
  function localPanel(eq){
    const zg = eq.zone_gaz || '—', zd = eq.zone_poussieres || eq.zone_poussiere || '—';
    const reqCat = requiredCategoryForZone(zg, zd);
    return `
      <h3>Analyse ATEX (fallback)</h3>
      <ul>
        <li><strong>Équipement</strong> : ${eq.composant || '—'}</li>
        <li><strong>Marquage</strong> : ${eq.marquage_atex || '—'}</li>
        <li><strong>Zones</strong> : Gaz ${zg} / Poussières ${zd}</li>
        <li><strong>Catégorie requise estimée</strong> : ${reqCat}</li>
      </ul>
      <p class="text-muted">Configurez OPENAI_API_KEY pour activer l’analyse IA détaillée.</p>
    `;
  }
  return { deriveLocal: localPanel };
})();

let OpenAI = null;
try { OpenAI = require('openai'); } catch {}

const hasKey = !!process.env.OPENAI_API_KEY && !!OpenAI;
const client = hasKey ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function equipToFacts(e){
  const fields = [
    ['Composant','composant'], ['Fournisseur','fournisseur'], ['Type','type'],
    ['Identifiant','identifiant'], ['Secteur','secteur'], ['Bâtiment','batiment'], ['Local','local'],
    ['Zone Gaz','zone_gaz'], ['Zone Poussières','zone_poussieres'], ['Marquage ATEX','marquage_atex'],
    ['Conformité','conformite'], ['Risque','risque'], ['Dernière inspection','last_inspection_date'], ['Prochaine inspection','next_inspection_date']
  ];
  const lines = fields.map(([k,p])=> `${k}: ${e?.[p] ?? '—'}`);
  return lines.join('\n');
}

async function oneShot(equipment){
  if (!hasKey) return deriveLocal(equipment);

  const system = `Tu es un expert ATEX (Directive 2014/34/UE) francophone.
- Analyse un équipement à partir de ses caractéristiques.
- Vérifie la cohérence marquage/zone (G: gaz / D: poussières) et la catégorie requise (zone 0/20⇒1, 1/21⇒2, 2/22⇒3).
- Donne un verdict clair (Conforme / Non conforme + raison), risques, et 3 à 5 recommandations actionnables.
- Réponds en HTML simple (listes <ul>, titres <h3>/<h4>). Pas de code block.`;

  const user = `Faits:\n${equipToFacts(equipment)}\n\nRends un panneau HTML concis (verdict, risques, recommandations).`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   }
    ]
  });

  const html = resp?.choices?.[0]?.message?.content?.trim() || '<p>(IA : pas de contenu)</p>';
  return html;
}

async function chat({ question, equipment = null, history = [] }){
  if (!hasKey){
    return `<div><h4>IA désactivée</h4><p>${question || '—'}</p><p class="text-muted">Ajoutez OPENAI_API_KEY pour activer le chat.</p></div>`;
  }
  const sys = `Assistant ATEX francophone. Donne des réponses factuelles, structurées, en HTML simple.`;
  const msgs = [{ role:'system', content: sys }];
  if (equipment){
    msgs.push({ role:'user', content: `Contexte équipement:\n${equipToFacts(equipment)}` });
    msgs.push({ role:'assistant', content: 'Contexte reçu.' });
  }
  for (const m of history || []){
    const role = (m.role === 'assistant') ? 'assistant' : 'user';
    msgs.push({ role, content: m.content });
  }
  msgs.push({ role:'user', content: question || 'Analyse ATEX' });

  const resp = await client.chat.completions.create({
    model: MODEL, temperature: 0.2, messages: msgs
  });
  return resp?.choices?.[0]?.message?.content?.trim() || '<p>(IA : pas de contenu)</p>';
}

module.exports = { oneShot, chat };
