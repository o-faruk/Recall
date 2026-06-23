// Recall — query Lambda (PHASE 3 — stub)
// Trigger: API Gateway POST /query  body: { question, documentIds? }
// Will: embed question -> Pinecone top-5 -> Claude(context+question)
//       -> return { answer, citations:[{documentId,filename,excerpt,chunkIndex}] }.
// Claude + embeddings are MOCKED until Phase 3 (USE_REAL_* flags = false).
export const handler = async (event) => {
  console.log("query Lambda not implemented yet (Phase 3)", JSON.stringify(event));
  return { statusCode: 501, body: "Not implemented (Phase 3)" };
};
