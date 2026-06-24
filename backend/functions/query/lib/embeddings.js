// ----------------------------------------------------------------------
// Recall — embeddings adapter (shared by process + query Lambdas)
// Mock by default; set USE_REAL_EMBEDDINGS=true to call Google Gemini
// (text-embedding-004, 768-dim) over plain HTTPS — no npm package needed.
//
// IMPORTANT: the process Lambda (embeds chunks) and the query Lambda
// (embeds the question) MUST use this exact same model/dimension, or the
// vectors won't be comparable. Keep these two files identical.
// ----------------------------------------------------------------------

const USE_REAL = process.env.USE_REAL_EMBEDDINGS === "true";
const MODEL = process.env.EMBEDDINGS_MODEL || "gemini-embedding-001";
const DIM = parseInt(process.env.EMBEDDINGS_DIM || "3072", 10); // gemini-embedding-001 = 3072

// embed(["a","b"]) -> [[...768 floats], [...768 floats]]
export async function embed(texts) {
  if (USE_REAL) return realEmbed(texts);
  return texts.map(mockEmbedding);
}

// Deterministic pseudo-vector (same text -> same unit vector). $0, no network.
function mockEmbedding(text) {
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  let x = seed || 1;
  const v = new Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    x = (1103515245 * x + 12345) & 0x7fffffff;
    const n = x / 0x7fffffff - 0.5;
    v[i] = n;
    norm += n * n;
  }
  norm = Math.sqrt(norm) || 1;
  return v.map((n) => n / norm);
}

// Real: Google Gemini batch embeddings. Batches of 100 to stay under limits.
async function realEmbed(texts) {
  const KEY = process.env.EMBEDDINGS_API_KEY;
  if (!KEY) throw new Error("EMBEDDINGS_API_KEY not set (Gemini key).");
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:batchEmbedContents?key=${KEY}`;
    const body = {
      requests: batch.map((t) => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text: t }] },
      })),
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini embeddings ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const e of data.embeddings) out.push(e.values);
  }
  return out;
}
