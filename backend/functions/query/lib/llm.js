// ----------------------------------------------------------------------
// Recall — LLM adapter (answer generation)
// Mock by default; set USE_REAL_CLAUDE=true to call the Anthropic API over
// plain HTTPS (no npm package needed). Model is configurable via CLAUDE_MODEL
// (default claude-haiku-4-5 — cheap; switch to claude-opus-4-8 for a demo).
//
// Returns: { answer: string, citations: [{documentId, filename, excerpt, chunkIndex}] }
// Citations are built from the ACTUAL retrieved chunks (not echoed by the
// model), so they always point at real source text.
// ----------------------------------------------------------------------

const USE_REAL = process.env.USE_REAL_CLAUDE === "true";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

// chunks: [{ documentId, filename, chunkIndex, text, score? }]
export async function generateAnswer(question, chunks) {
  if (USE_REAL) return realAnswer(question, chunks);

  // Mock: no API call. Echo a templated answer + cite every retrieved chunk.
  return {
    answer:
      `(mock answer — real Claude disabled) Using ${chunks.length} retrieved chunk(s), ` +
      `this is where Claude's grounded answer to "${question}" would appear.`,
    citations: chunks.map((c) => ({
      documentId: c.documentId,
      filename: c.filename,
      excerpt: c.text.slice(0, 240),
      chunkIndex: c.chunkIndex,
    })),
  };
}

async function realAnswer(question, chunks) {
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) throw new Error("ANTHROPIC_API_KEY not set.");

  // Number the sources so Claude can reference them; we map numbers -> citations.
  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.filename}, chunk ${c.chunkIndex})\n${c.text}`)
    .join("\n\n");

  const prompt =
    `You are Recall, a document Q&A assistant. Answer the question using ONLY the ` +
    `numbered sources below. If the sources don't contain the answer, say so.\n\n` +
    `Respond with STRICT JSON only (no markdown), shape:\n` +
    `{"answer": "<your answer>", "usedSources": [<source numbers you relied on>]}\n\n` +
    `Sources:\n${context}\n\nQuestion: ${question}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "";

  // Parse Claude's JSON; fall back gracefully if it didn't comply.
  let answer = raw;
  let used = chunks.map((_, i) => i + 1);
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
    if (parsed.answer) answer = parsed.answer;
    if (Array.isArray(parsed.usedSources) && parsed.usedSources.length) used = parsed.usedSources;
  } catch {
    /* keep raw answer + cite all retrieved chunks */
  }

  const citations = used
    .map((n) => chunks[n - 1])
    .filter(Boolean)
    .map((c) => ({
      documentId: c.documentId,
      filename: c.filename,
      excerpt: c.text.slice(0, 240),
      chunkIndex: c.chunkIndex,
    }));

  return { answer, citations };
}
