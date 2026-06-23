// Recall — process Lambda (PHASE 2 — stub)
// Trigger: S3 ObjectCreated event on the documents bucket.
// Will: extract text (pdf-parse) -> chunk (500 tok / 50 overlap) -> embed
//       -> upsert vectors to Pinecone -> set DynamoDB status "ready".
// Embeddings + Pinecone are MOCKED in Phase 2 (USE_REAL_* flags = false).
export const handler = async (event) => {
  console.log("process Lambda not implemented yet (Phase 2)", JSON.stringify(event));
  return { statusCode: 501, body: "Not implemented (Phase 2)" };
};
