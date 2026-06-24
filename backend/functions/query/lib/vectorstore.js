// ----------------------------------------------------------------------
// Recall — vector store adapter (shared by process + query Lambdas)
// Mock by default; set USE_REAL_PINECONE=true to talk to Pinecone over the
// REST API (plain HTTPS — no npm package needed).
// To swap to OpenSearch/Kendra later, only rewrite the real* branches here.
//
// Env: PINECONE_API_KEY, PINECONE_HOST (the index host WITHOUT https://,
// e.g. recall-xxxx.svc.aped-1234.pinecone.io)
// ----------------------------------------------------------------------

const USE_REAL = process.env.USE_REAL_PINECONE === "true";
const API_VERSION = "2025-01";

function pineconeHeaders() {
  const KEY = process.env.PINECONE_API_KEY;
  if (!KEY) throw new Error("PINECONE_API_KEY not set.");
  return { "Api-Key": KEY, "Content-Type": "application/json", "X-Pinecone-API-Version": API_VERSION };
}
function pineconeHost() {
  const HOST = process.env.PINECONE_HOST;
  if (!HOST) throw new Error("PINECONE_HOST not set.");
  return HOST.replace(/^https?:\/\//, "");
}

// --- upsert (used by the process Lambda) --------------------------------
// vectors: [{ id, values: number[], metadata: {...} }]
export async function upsertVectors(vectors) {
  if (USE_REAL) return realUpsert(vectors);
  console.log(`[mock pinecone] would upsert ${vectors.length} vectors`);
  if (vectors[0]) {
    console.log(
      `[mock pinecone] sample id=${vectors[0].id} dim=${vectors[0].values.length}`,
      "meta=",
      JSON.stringify({ ...vectors[0].metadata, text: vectors[0].metadata.text.slice(0, 80) + "…" })
    );
  }
  return { upserted: vectors.length, mocked: true };
}

async function realUpsert(vectors) {
  const res = await fetch(`https://${pineconeHost()}/vectors/upsert`, {
    method: "POST",
    headers: pineconeHeaders(),
    body: JSON.stringify({ vectors }),
  });
  if (!res.ok) throw new Error(`Pinecone upsert ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- query (used by the query Lambda) -----------------------------------
// returns [{ id, score, metadata: { documentId, filename, chunkIndex, text } }]
export async function queryVectors(vector, topK = 5, filter) {
  if (USE_REAL) return realQuery(vector, topK, filter);
  // Mock: there are no stored vectors, so fabricate one match so the rest of
  // the query pipeline (Claude prompt, citations) can be exercised at $0.
  console.log(`[mock pinecone] would query topK=${topK}`, filter ? `filter=${JSON.stringify(filter)}` : "");
  return [
    {
      id: "mock-doc#0",
      score: 0.99,
      metadata: {
        documentId: "mock-doc",
        filename: "mock-document.pdf",
        chunkIndex: 0,
        text: "This is a mock retrieved chunk. Real Pinecone search is disabled (USE_REAL_PINECONE=false).",
      },
    },
  ];
}

async function realQuery(vector, topK, filter) {
  const body = { topK, vector, includeMetadata: true };
  if (filter) body.filter = filter;
  const res = await fetch(`https://${pineconeHost()}/query`, {
    method: "POST",
    headers: pineconeHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pinecone query ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.matches || []).map((m) => ({ id: m.id, score: m.score, metadata: m.metadata }));
}
