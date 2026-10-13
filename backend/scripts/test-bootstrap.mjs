import 'dotenv/config';
// Automated checks use local model mocks or approved excerpts, never the developer's paid key.
// Live OpenAI behavior is checked separately through the running chatbot.
for (const name of ['OPENAI_API_KEY', 'AI_API_KEY', 'EMBEDDING_API_KEY']) process.env[name] = '';
