// ----------------------------------------------------------------------
// Recall — process Lambda
// Trigger:  S3 ObjectCreated event (prefix "raw/") on the documents bucket.
// Does:     status->processing -> GetObject -> extract text -> chunk
//           -> embed (MOCK) -> upsert vectors (MOCK) -> status->ready.
// IAM:      s3:GetObject (bucket/raw/*) + dynamodb:UpdateItem (table) ONLY.
//
// Embeddings + Pinecone are MOCKED in Phase 2 (USE_REAL_* flags = false), so
// this runs end-to-end for $0. Text extraction + chunking are REAL.
// ----------------------------------------------------------------------

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import pdfParse from "pdf-parse/lib/pdf-parse.js"; // import the lib directly to skip pdf-parse's debug wrapper
import { embed } from "./lib/embeddings.js";
import { upsertVectors } from "./lib/vectorstore.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_TABLE_NAME;
const CHUNK_TOKENS = parseInt(process.env.CHUNK_TOKENS || "500", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "50", 10);

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export const handler = async (event) => {
  // S3 can batch several objects into one event.
  for (const record of event.Records || []) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    // The upload Lambda names objects "raw/<documentId>.<ext>", so the basename
    // (minus extension) IS the documentId. Confirmed against S3 metadata below.
    let documentId = key.split("/").pop().replace(/\.[^.]+$/, "");

    try {
      await setStatus(documentId, "processing");

      // 1. download the raw file
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = Buffer.from(await obj.Body.transformToByteArray());

      // metadata written by the upload Lambda (source of truth for filename)
      const meta = obj.Metadata || {};
      if (meta.documentid) documentId = meta.documentid;
      const filename = meta.filename ? decodeURIComponent(meta.filename) : key.split("/").pop();

      // 2. extract text by file type
      const ext = key.toLowerCase().split(".").pop();
      let text;
      if (ext === "pdf") {
        text = (await pdfParse(bytes)).text;
      } else if (ext === "txt") {
        text = bytes.toString("utf8");
      } else {
        throw new Error(`Unsupported file type ".${ext}" (Phase 2 handles PDF + TXT).`);
      }
      text = (text || "").replace(/\s+/g, " ").trim();
      if (!text) throw new Error("No extractable text found in document.");

      // 3. chunk (~500 tokens, 50 overlap)
      const chunks = chunkText(text, CHUNK_TOKENS, CHUNK_OVERLAP);

      // 4. embed each chunk (MOCK in Phase 2)
      const values = await embed(chunks);

      // 5. build vectors + store them (MOCK in Phase 2)
      const vectors = chunks.map((chunk, i) => ({
        id: `${documentId}#${i}`,
        values: values[i],
        metadata: { documentId, chunkIndex: i, text: chunk, filename, s3Key: key },
      }));
      await upsertVectors(vectors);

      // 6. mark ready
      await setReady(documentId, chunks.length);
      console.log(`Processed "${filename}" (${documentId}): ${chunks.length} chunks.`);
    } catch (err) {
      console.error(`process error for key "${key}":`, err);
      // best-effort: record the failure so the frontend can show an error badge
      await setError(documentId, err.message).catch(() => {});
    }
  }
  return { ok: true };
};

// --- helpers -------------------------------------------------------------

// Approximate token-based chunking. We split on whitespace (words) and use
// ~1.33 tokens/word to convert the 500/50 token targets into word counts.
// Easy to swap for a real tokenizer (e.g. gpt-tokenizer) later if needed.
export function chunkText(text, tokensPerChunk = 500, overlapTokens = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const perChunk = Math.max(1, Math.round(tokensPerChunk / 1.33));
  const overlap = Math.min(perChunk - 1, Math.round(overlapTokens / 1.33));
  const step = Math.max(1, perChunk - overlap);
  const chunks = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + perChunk);
    if (!slice.length) break;
    chunks.push(slice.join(" "));
    if (i + perChunk >= words.length) break; // last window reached the end
  }
  return chunks;
}

// NOTE: "status" is a DynamoDB reserved word, so it must be aliased (#s).
const setStatus = (documentId, status) =>
  ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { documentId },
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
    })
  );

const setReady = (documentId, chunkCount) =>
  ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { documentId },
      UpdateExpression: "SET #s = :s, chunkCount = :c REMOVE errorMessage",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "ready", ":c": chunkCount },
    })
  );

const setError = (documentId, message) =>
  ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { documentId },
      UpdateExpression: "SET #s = :s, errorMessage = :e",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "error", ":e": String(message).slice(0, 500) },
    })
  );
