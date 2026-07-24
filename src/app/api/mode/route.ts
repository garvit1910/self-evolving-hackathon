import { getLLMConfig } from '@/lib/llm';

// Tells the client whether live mode is available (any LLM route configured —
// Pioneer when USE_REAL_PIONEER=1, else LLM_*/OpenAI keys).
export async function GET() {
  return Response.json({ mode: getLLMConfig() ? 'live' : 'offline' });
}
