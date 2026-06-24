// ----------------------------------------------------------------------
// Recall — query Lambda
// Trigger:  API Gateway  POST /query  (Lambda proxy) — for Phase 3 you can
//           test it straight from the Lambda Test tab; API Gateway is Phase 5.
// Body:     { "question": string, "documentIds"?: string[] }
// Does:     embed question -> Pinecone top-5 (optional doc filter)
//           -> Claude(context + question) -> { answer, citations[] }
// IAM:      none beyond CloudWatch Logs. All data comes from Pinecone metadata
//           + external APIs (keys live in env vars, not IAM).
//
// Embeddings/Pinecone/Claude are mockable via USE_REAL_* env flags.
// ----------------------------------------------------------------------

import { embed } from "./lib/embeddings.js";
import { queryVectors } from "./lib/vectorstore.js";
import { generateAnswer } from "./lib/llm.js";

const TOP_K = parseInt(process.env.TOP_K || "5", 10);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Content-Type": "application/json",
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

export const handler = async (event) => {
  try {
    if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
      return reply(200, { ok: true });
    }

    // 1. parse + validate
    let payload;
    try {
      payload = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch {
      return reply(400, { error: "Body must be valid JSON." });
    }
    const question = (payload.question || "").trim();
    const documentIds = Array.isArray(payload.documentIds) ? payload.documentIds : null;
    if (!question) return reply(400, { error: "A non-empty 'question' is required." });

    // 2. embed the question (same model as the chunks)
    const [qvec] = await embed([question]);

    // 3. search Pinecone (optionally restrict to specific documents)
    const filter = documentIds && documentIds.length ? { documentId: { $in: documentIds } } : undefined;
    const matches = await queryVectors(qvec, TOP_K, filter);
    const chunks = matches.map((m) => ({ ...m.metadata, score: m.score }));

    if (!chunks.length) {
      return reply(200, {
        answer: "I couldn't find anything relevant in your documents for that question.",
        citations: [],
      });
    }

    // 4. ask Claude, grounded in the retrieved chunks
    const { answer, citations } = await generateAnswer(question, chunks);

    return reply(200, { answer, citations });
  } catch (err) {
    console.error("query Lambda error:", err);
    return reply(500, { error: "Query failed. Please try again." });
  }
};
