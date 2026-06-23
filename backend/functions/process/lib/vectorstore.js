// ----------------------------------------------------------------------
// Recall — vector store adapter
// MOCKED by default (Phase 2). Flip USE_REAL_PINECONE=true in Phase 3.
// Designed to be swappable: to move to AWS OpenSearch or Kendra later, you
// only rewrite the realUpsert() body — the process Lambda stays untouched.
// ----------------------------------------------------------------------

const USE_REAL = process.env.USE_REAL_PINECONE === "true";

// vectors: [{ id, values: number[], metadata: {...} }]
export async function upsertVectors(vectors) {
  if (USE_REAL) return realUpsert(vectors);

  // Mock: call nothing, just report what WOULD be sent so you can verify the
  // pipeline in CloudWatch logs at $0.
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
  // TODO Phase 3: upsert to Pinecone via @pinecone-database/pinecone using
  // PINECONE_API_KEY / PINECONE_INDEX / PINECONE_HOST from env.
  throw new Error("Real Pinecone not wired yet — enabled in Phase 3.");
}
