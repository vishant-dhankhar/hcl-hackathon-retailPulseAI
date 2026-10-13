import { z } from 'zod';
import { assert } from '../errors/HttpError.js';
// One OpenAI key serves chat and embeddings; explicit legacy settings remain supported.
export const chatKey = () => process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
export const chatModel = () =>
  process.env.AI_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini';
export const embeddingKey = () => process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
export const embeddingModel = () => process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
// All four candidate providers expose compatible chat endpoints. Keep credentials server-only.
// Endpoint/model selection is configuration, so the retail services stay provider-independent.
export async function generateJson(
  system: string,
  input: unknown,
  tool?: { name: string; description: string; parameters: Record<string, unknown> },
) {
  assert(chatKey(), 503, 'AI_UNAVAILABLE', 'Configure an AI provider to enable generated answers.');
  const response = await fetch(
    `${(process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: `Bearer ${chatKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: chatModel(),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
        temperature: 0.1,
        ...(tool
          ? {
              tools: [{ type: 'function', function: { ...tool, strict: false } }],
              tool_choice: { type: 'function', function: { name: tool.name } },
              parallel_tool_calls: false,
            }
          : { response_format: { type: 'json_object' } }),
        max_completion_tokens: 1800,
        store: false,
      }),
    },
  );
  assert(response.ok, 503, 'AI_UNAVAILABLE', 'The AI provider is unavailable. Try again later.');
  const result = (await response.json()) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const message = result.choices?.[0]?.message;
  if (tool)
    assert(
      message?.tool_calls?.length === 1 && message.tool_calls[0].function.name === tool.name,
      503,
      'INVALID_TOOL',
      'The assistant could not prepare a valid search. Please try again.',
    );
  try {
    return JSON.parse(tool ? message!.tool_calls![0].function.arguments : message?.content || '');
  } catch {
    throw new Error('Invalid provider JSON response');
  }
}
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  assert(embeddingKey(), 503, 'EMBEDDINGS_UNAVAILABLE', 'Embedding provider is not configured.');
  const response = await fetch(
    `${(process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/embeddings`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: `Bearer ${embeddingKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: embeddingModel(),
        input: texts,
        dimensions: 1536,
      }),
    },
  );
  assert(
    response.ok,
    503,
    'EMBEDDINGS_UNAVAILABLE',
    'Embedding provider could not process this content.',
  );
  const result = z
    .object({
      data: z
        .array(
          z.object({
            index: z.number().int().nonnegative(),
            embedding: z.array(z.number().finite()).length(1536),
          }),
        )
        .length(texts.length),
    })
    .parse(await response.json());
  // OpenAI returns an index for each input; never pair a vector with the wrong paragraph.
  const sorted = result.data.sort((a, b) => a.index - b.index);
  assert(
    sorted.every((v, i) => v.index === i && v.embedding.some((n) => n !== 0)),
    503,
    'INVALID_EMBEDDING',
    'The embedding provider returned invalid vectors.',
  );
  return sorted.map((v) => v.embedding);
}
export async function embed(text: string): Promise<number[]> {
  return (await embedMany([text]))[0];
}
