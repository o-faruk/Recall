// ----------------------------------------------------------------------
// Recall — upload Lambda
// Trigger:  API Gateway  POST /documents  (Lambda proxy integration)
// Does:     validate file -> put raw bytes in S3 -> write metadata row to
//           DynamoDB (status: "uploaded") -> return { documentId }
// IAM:      s3:PutObject (bucket) + dynamodb:PutItem (table) ONLY
//           (see infrastructure/iam-roles/upload-lambda-role.json)
//
// NOTE: S3 + DynamoDB are REAL here (both free tier). The "mock" services
// (embeddings / Pinecone / Claude) do not appear until Phase 2 / 3.
// ----------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.S3_BUCKET_NAME;
const TABLE = process.env.DYNAMO_TABLE_NAME;

// Reuse clients across warm invocations (cheaper + faster).
const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// --- config / guardrails -------------------------------------------------
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap keeps us safely inside free tier
const ALLOWED = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

// CORS headers — every response (success AND error) must include these or the
// browser will block the frontend. Locked down further in Phase 5.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Content-Type": "application/json",
};

const reply = (statusCode, body) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  try {
    // CORS preflight (browser sends OPTIONS before the real POST).
    if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
      return reply(200, { ok: true });
    }

    // --- 1. parse + validate input --------------------------------------
    if (!BUCKET || !TABLE) {
      return reply(500, { error: "Server misconfigured: missing S3_BUCKET_NAME or DYNAMO_TABLE_NAME." });
    }

    let payload;
    try {
      payload = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch {
      return reply(400, { error: "Body must be valid JSON." });
    }

    const { filename, fileType, fileData } = payload || {};
    if (!filename || !fileType || !fileData) {
      return reply(400, { error: "filename, fileType, and fileData (base64) are required." });
    }
    if (!ALLOWED[fileType]) {
      return reply(415, { error: `Unsupported fileType "${fileType}". Allowed: PDF, TXT, DOCX.` });
    }

    // fileData is expected to be base64 (optionally a data URL).
    const base64 = fileData.includes(",") ? fileData.split(",").pop() : fileData;
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) return reply(400, { error: "fileData decoded to 0 bytes." });
    if (buffer.length > MAX_BYTES) {
      return reply(413, { error: `File too large (${buffer.length} bytes). Max ${MAX_BYTES}.` });
    }

    // --- 2. write raw file to S3 ----------------------------------------
    const documentId = randomUUID();
    const ext = ALLOWED[fileType];
    const s3Key = `raw/${documentId}${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: fileType,
        // tag the object so the process Lambda (Phase 2) can read metadata
        Metadata: { documentid: documentId, filename: encodeURIComponent(filename) },
      })
    );

    // --- 3. write metadata row to DynamoDB ------------------------------
    const item = {
      documentId,                       // Partition Key (String)
      filename,
      uploadDate: new Date().toISOString(),
      s3Key,
      status: "uploaded",               // uploaded -> processing -> ready | error
      chunkCount: 0,
      fileSize: buffer.length,
      fileType,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    // --- 4. respond -----------------------------------------------------
    return reply(201, { documentId, status: "uploaded", filename });
  } catch (err) {
    // Never leak stack traces to the client; log them for CloudWatch instead.
    console.error("upload Lambda error:", err);
    return reply(500, { error: "Upload failed. Please try again." });
  }
};
