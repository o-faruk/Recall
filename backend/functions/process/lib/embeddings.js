// ----------------------------------------------------------------------
// Recall — embeddings adapter
// MOCKED by default (Phase 2). Flip USE_REAL_EMBEDDINGS=true in Phase 3 to
// call a real provider. This is the ONLY place embedding logic lives, so the
// rest of the pipeline never changes when you swap mock -> real.
// ----------------------------------------------------------------------

const USE_REAL = process.env.USE_REAL_EMBEDDINGS === "true";
const DIM = parseInt(process.env.EMBEDDINGS_DIM || "1536", 10); // matches text-embedding-3-small

// embed(["chunk a", "chunk b"]) -> [[...DIM floats], [...DIM floats]]
export async function embed(texts) {
  if (USE_REAL) return realEmbed(texts);
  return texts.map(mockEmbedding);
}

// Deterministic pseudo-vector: same text always produces the same unit vector,
// so the pipeline behaves exactly like the real thing (just not semantically
// meaningful). Costs nothing and never calls the network.
function mockEmbedding(text) {
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  let x = seed || 1;
  const v = new Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    x = (1103515245 * x + 12345) & 0x7fffffff; // simple LCG PRNG
    const n = x / 0x7fffffff - 0.5;
    v[i] = n;
    norm += n * n;
  }
  norm = Math.sqrt(norm) || 1;
  return v.map((n) => n / norm); // unit-normalized, like real embeddings
}

// eslint-disable-next-line no-unused-vars
async function realEmbed(texts) {
  // TODO Phase 3: call OpenAI text-embedding-3-small (or chosen provider) and
  // return one DIM-length array per input string. Read EMBEDDINGS_API_KEY /
  // EMBEDDINGS_MODEL from env. Nothing else in the codebase needs to change.
  throw new Error("Real embeddings not wired yet — enabled in Phase 3.");
}
