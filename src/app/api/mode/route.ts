// Tells the client whether live mode is available (any LLM key present).
export async function GET() {
  const live = Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);
  return Response.json({ mode: live ? 'live' : 'offline' });
}
