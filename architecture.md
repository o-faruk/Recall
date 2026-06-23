# Recall — Architecture

This document explains how Recall works end-to-end and why each piece exists. It's written to be read alongside the code, and to be defensible in an internship interview.

## The RAG problem Recall solves

A large language model only "knows" what it was trained on. If you ask Claude about *your* PDF, it has never seen it. **Retrieval-Augmented Generation (RAG)** fixes this by:

1. **Indexing** your documents ahead of time — splitting them into small chunks and converting each chunk into a vector (a list of numbers that captures meaning).
2. **Retrieving** the chunks most relevant to a question at query time (vector similarity search).
3. **Augmenting** the prompt — handing those chunks to the LLM as context.
4. **Generating** an answer grounded in that context, with citations back to the source.

This keeps answers accurate, current, and verifiable, without retraining any model.

## Component responsibilities

### React frontend (Vite)
The user-facing app: drag-and-drop upload, a document list with live status badges, a chat interface, and expandable citation cards. Talks only to API Gateway over HTTPS.

### API Gateway (REST)
The single public front door. It exposes a small set of HTTPS endpoints and forwards each request to the right Lambda. It also enforces CORS so only our frontend can call it from the browser.

### Lambda functions (Node.js 20.x)
Stateless functions that run on demand — no servers to manage, and you only pay per request (effectively free at portfolio scale). Three functions, each with its **own** narrowly-scoped IAM role:

- **`upload`** — validates an incoming file, stores the raw bytes in S3, writes a metadata row to DynamoDB with `status: "uploaded"`, and returns a `documentId`.
- **`process`** — triggered automatically when S3 receives a new object. Extracts text, splits it into overlapping chunks, embeds each chunk, upserts the vectors into Pinecone, and flips DynamoDB `status` to `ready`.
- **`query`** — embeds the user's question, finds the top-K similar chunks in Pinecone, builds a prompt for Claude, and returns a structured answer with citations.

### S3 — raw document storage
Object storage for the original uploaded files. Versioning is on (recover overwritten files) and all public access is blocked (documents are private). S3's `ObjectCreated` event is what kicks off the `process` Lambda — this event-driven design means the frontend never waits on processing.

### DynamoDB — metadata
A fast NoSQL key-value store holding one item per document: id, filename, upload date, S3 key, status, chunk count, file size, file type. The frontend polls this to show live status badges. DynamoDB is used (not the vector DB) because status lookups are simple key reads and DynamoDB's free tier is generous and permanent.

### Pinecone — vector database
A purpose-built store for embeddings. Given a question vector, it returns the most similar chunk vectors in milliseconds. Kept separate from DynamoDB because similarity search is a fundamentally different operation than key lookup. **Designed to be swappable** — the vector layer sits behind a thin interface so it can later be replaced with AWS OpenSearch or Kendra.

### Anthropic Claude — answer generation
Given the retrieved chunks + the question, Claude writes the final answer and returns citations as structured JSON. Bedrock is intentionally avoided to stay within free tier; the Anthropic API is called directly.

## Data flow

**Upload:** Frontend → API Gateway → `upload` Lambda → S3 (raw file) + DynamoDB (`status: uploaded`) → returns `documentId`.

**Process (automatic):** S3 `ObjectCreated` → `process` Lambda → extract text → chunk (500 tokens, 50 overlap) → embed → Pinecone upsert → DynamoDB (`status: ready`).

**Query:** Frontend → API Gateway → `query` Lambda → embed question → Pinecone top-5 → Claude(context + question) → `{ answer, citations[] }` → frontend renders answer + citation cards.

## Security model — least privilege

There is no single broad role. Each Lambda assumes a role granting only the exact actions it needs:

- `upload` → `s3:PutObject` on the bucket + `dynamodb:PutItem` on the table. Nothing else.
- `process` → `s3:GetObject` + `dynamodb:UpdateItem` (+ outbound calls to Pinecone/embeddings).
- `query` → `dynamodb:GetItem`/`Query` (+ outbound calls to Pinecone/Claude).

If any one function were compromised, the blast radius is limited to its specific permissions.

## Cost posture

Everything is chosen to sit inside the AWS free tier (see README for the limits). Mock responses stand in for embeddings, Pinecone, and Claude during Phases 1–2 so the storage flow can be tested at $0. Billing alerts are configured on day one.

## Swappability (resume optionality)

The external services (embeddings, vector DB, LLM) are accessed through thin adapter modules toggled by `USE_REAL_*` env flags. This makes it cheap to later swap Pinecone for **AWS OpenSearch** or **Kendra**, or change the embedding/LLM provider, without touching the Lambda business logic.
