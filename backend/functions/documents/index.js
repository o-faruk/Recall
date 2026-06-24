// ----------------------------------------------------------------------
// Recall — documents (read) Lambda
// Trigger:  API Gateway
//   GET /documents              -> list all docs (DynamoDB Scan)
//   GET /documents/{documentId} -> one doc's metadata/status (GetItem)
// Used by the frontend's document list + status polling (live mode).
// IAM:      dynamodb:Scan + dynamodb:GetItem on the table ONLY.
//
// No npm dependencies — the AWS SDK ships with the Node 20 runtime.
// ----------------------------------------------------------------------

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
  "Content-Type": "application/json",
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

// Only expose fields the UI needs (omit internal s3Key).
const publicView = (it) => ({
  documentId: it.documentId,
  filename: it.filename,
  uploadDate: it.uploadDate,
  status: it.status,
  chunkCount: it.chunkCount ?? 0,
  fileSize: it.fileSize,
  fileType: it.fileType,
  ...(it.errorMessage ? { errorMessage: it.errorMessage } : {}),
});

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === "OPTIONS") return reply(200, { ok: true });
    if (!TABLE) return reply(500, { error: "Server misconfigured: DYNAMO_TABLE_NAME missing." });

    const id = event.pathParameters?.documentId;

    // GET /documents/{id}
    if (id) {
      const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { documentId: id } }));
      if (!Item) return reply(404, { error: "Document not found." });
      return reply(200, publicView(Item));
    }

    // GET /documents  (Scan is fine at portfolio scale; for large tables you'd
    // add a GSI and Query instead — noted as a future improvement.)
    const { Items = [] } = await ddb.send(new ScanCommand({ TableName: TABLE }));
    const docs = Items
      .map(publicView)
      .sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));
    return reply(200, docs);
  } catch (err) {
    console.error("documents Lambda error:", err);
    return reply(500, { error: "Failed to read documents." });
  }
};
