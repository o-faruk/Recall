// ----------------------------------------------------------------------
// Recall — delete Lambda
// Trigger: API Gateway  DELETE /documents/{documentId}
// Removes a document everywhere:
//   1. Pinecone vectors  (by ID: "<documentId>#0..<chunkCount-1>")
//   2. S3 raw file        (raw/<documentId>.<ext>)
//   3. DynamoDB record
// IAM: s3:DeleteObject + dynamodb:GetItem + dynamodb:DeleteItem on the table.
//
// No npm dependencies — AWS SDK is in the runtime; Pinecone via fetch().
// Vectors are deleted BY ID (not metadata filter) because filter-deletes are
// not supported on Pinecone serverless/free indexes.
// ----------------------------------------------------------------------

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_TABLE_NAME || "RecallDocuments";
const PINECONE_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX_NAME || process.env.PINECONE_INDEX || "recall";
const API_VERSION = "2025-01";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,DELETE",
  "Content-Type": "application/json",
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

// Resolve the Pinecone data-plane host (prefer env, else ask the control API).
async function pineconeHost() {
  if (process.env.PINECONE_HOST) return process.env.PINECONE_HOST.replace(/^https?:\/\//, "");
  const res = await fetch(`https://api.pinecone.io/indexes/${PINECONE_INDEX}`, {
    headers: { "Api-Key": PINECONE_KEY, "X-Pinecone-API-Version": API_VERSION },
  });
  if (!res.ok) throw new Error(`Pinecone describe-index ${res.status}: ${await res.text()}`);
  return (await res.json()).host;
}

async function deletePineconeVectors(documentId, chunkCount) {
  if (!PINECONE_KEY || !chunkCount) return;
  const ids = Array.from({ length: chunkCount }, (_, i) => `${documentId}#${i}`);
  const host = await pineconeHost();
  const res = await fetch(`https://${host}/vectors/delete`, {
    method: "POST",
    headers: { "Api-Key": PINECONE_KEY, "Content-Type": "application/json", "X-Pinecone-API-Version": API_VERSION },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Pinecone delete ${res.status}: ${await res.text()}`);
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === "OPTIONS") return reply(200, { ok: true });

  const documentId = event.pathParameters?.documentId;
  if (!documentId) return reply(400, { error: "Missing documentId in path." });

  try {
    // 1. fetch the record (need s3Key + chunkCount; also confirms it exists)
    const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { documentId } }));
    if (!Item) return reply(404, { error: "Document not found." });

    // 2. Pinecone vectors (best-effort — don't block the rest if it errors)
    try {
      await deletePineconeVectors(documentId, Item.chunkCount || 0);
    } catch (e) {
      console.error("Pinecone delete error:", e);
    }

    // 3. S3 raw file (use stored s3Key; fall back to raw/<id>.pdf)
    const s3Key = Item.s3Key || `raw/${documentId}.pdf`;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: s3Key }));
    } catch (e) {
      console.error("S3 delete error:", e);
    }

    // 4. DynamoDB record (the source of truth — do this last)
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { documentId } }));

    return reply(200, { message: "Document deleted successfully", documentId });
  } catch (err) {
    console.error("delete Lambda error:", err);
    return reply(500, { error: err.message || "Failed to delete document." });
  }
};
