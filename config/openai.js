// config/openai.js — OpenAI for ATEX
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = {
  oneShot: async (equipment) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Analyse ATEX en français.' },
        { role: 'user', content: JSON.stringify(equipment) }
      ]
    });
    return completion.choices[0].message.content;
  },
  chat: async ({ question, equipment, history }) => {
    const messages = [{ role: 'system', content: 'Assistant ATEX.' }];
    if (equipment) messages.push({ role: 'user', content: `Equipement: ${JSON.stringify(equipment)}` });
    history.forEach(m => messages.push(m));
    messages.push({ role: 'user', content: question });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });
    return completion.choices[0].message.content;
  }
};
