// ======================================================================
// Recall DELETE Lambda — removes a document from the system
// DELETE /documents/{documentId}
// ======================================================================
// Deletes:
//   1. DynamoDB record (RecallDocuments table)
//   2. S3 raw file (raw/{documentId}.pdf)
//   3. Pinecone vectors (metadata: {"doc_id": documentId})
// ======================================================================

import { DynamoDBDocumentClient, GetItem, DeleteItem } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Pinecone } from "@pinecone-database/pinecone";

const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(dynamoDBClient);

const s3 = new S3Client({ region: "us-east-1" });

const dynamoTableName = process.env.DYNAMO_TABLE_NAME || "RecallDocuments";
const s3BucketName = process.env.S3_BUCKET_NAME || "recall-documents";
const pineconeApiKey = process.env.PINECONE_API_KEY;
const pineconeIndexName = process.env.PINECONE_INDEX_NAME || "recall";

let pc = null;

async function initPinecone() {
  if (!pineconeApiKey) return null;
  if (pc) return pc;
  pc = new Pinecone({ apiKey: pineconeApiKey });
  return pc;
}

export const handler = async (event) => {
  console.log("DELETE /documents/{documentId}", JSON.stringify(event));

  try {
    // Extract documentId from the path
    const documentId =
      event.pathParameters?.documentId || event.requestContext?.resourceId;
    if (!documentId)
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing documentId in path" }),
        headers: { "Access-Control-Allow-Origin": "*" },
      };

    // 1. Get the document from DynamoDB to verify it exists
    const getResult = await ddb.send(
      new GetItem({
        TableName: dynamoTableName,
        Key: { documentId },
      })
    );

    if (!getResult.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Document not found" }),
        headers: { "Access-Control-Allow-Origin": "*" },
      };
    }

    // 2. Delete from S3
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: s3BucketName,
          Key: `raw/${documentId}.pdf`,
        })
      );
      console.log(`Deleted S3 object: raw/${documentId}.pdf`);
    } catch (e) {
      console.error("S3 delete error:", e);
      // don't fail if S3 delete fails; continue
    }

    // 3. Delete from Pinecone (by filtering metadata)
    if (pineconeApiKey) {
      try {
        const pc = await initPinecone();
        const index = pc.Index(pineconeIndexName);
        // Delete all vectors with metadata doc_id == documentId
        await index.deleteMany({
          filter: { doc_id: { $eq: documentId } },
        });
        console.log(`Deleted Pinecone vectors for doc ${documentId}`);
      } catch (e) {
        console.error("Pinecone delete error:", e);
        // don't fail if Pinecone delete fails; continue
      }
    }

    // 4. Delete from DynamoDB
    await ddb.send(
      new DeleteItem({
        TableName: dynamoTableName,
        Key: { documentId },
      })
    );
    console.log(`Deleted DynamoDB record: ${documentId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Document deleted successfully" }),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  } catch (err) {
    console.error("Error deleting document:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Failed to delete document",
      }),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  }
};
