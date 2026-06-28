# Recall — Architecture

How Recall works end to end, and why each piece exists.

## The problem: RAG

A language model only knows what it was trained on — it has never seen *your* PDF. **Retrieval-Augmented Generation (RAG)** fixes this by:

1. **Indexing** documents ahead of time — splitting them into small chunks and converting each chunk into a vector (numbers that capture meaning).
2. **Retrieving** the chunks most relevant to a question via vector similarity search.
3. **Augmenting** the prompt — handing those chunks to the model as context.
4. **Generating** an answer grounded in that context, with citations back to the source.

This keeps answers accurate and verifiable without retraining any model.

## Components

### Frontend — React + Vite on AWS Amplify
The user-facing app: drag-and-drop upload, a document list with live status badges, a chat interface, and expandable citation cards. Built with Vite, hosted on **AWS Amplify** with CI/CD straight from GitHub (every push to `main` rebuilds and redeploys). It talks only to API Gateway over HTTPS.

### Auth — Amazon Cognito
A Cognito user pool gates the app: visitors hit a login screen, and self-registration is disabled (accounts are created by the admin). The frontend sends the user's Cognito ID token on every API call, and **API Gateway validates it with a Cognito authorizer** — so the backend rejects any unauthenticated request. This protects both privacy and cost (no anonymous calls can burn LLM credits).

### API Gateway (REST)
The single front door. It exposes the HTTPS routes, forwards each to the right Lambda (proxy integration), enforces CORS, and runs the Cognito authorizer on every method except the CORS preflight.

### Lambda functions (Node.js 20.x)
Stateless, on-demand functions — no servers, pay per request. Each has its **own** narrowly-scoped IAM role:

- **`upload`** — validates a file, stores raw bytes in S3, writes a metadata row to DynamoDB (`status: uploaded`), returns a `documentId`.
- **`process`** — triggered automatically by the S3 upload event. Extracts text, splits it into overlapping chunks, embeds each with Gemini, upserts the vectors to Pinecone, flips status to `ready`.
- **`query`** — embeds the question, retrieves the top-K similar chunks from Pinecone, prompts Claude, returns a structured answer with citations.
- **`documents`** — read-only: lists all documents and returns a single document's status (powers the sidebar + status polling).
- **`delete`** — removes a document everywhere: its vectors from Pinecone (by ID), its file from S3, and its row from DynamoDB.

### S3 — raw document storage
Object storage for original files. Versioning on, all public access blocked. Its `ObjectCreated` event is what kicks off `process`, so the frontend never waits on processing.

### DynamoDB — metadata
One item per document (id, filename, upload date, S3 key, status, chunk count, size, type). Used for fast key lookups and live status; its free tier is generous and permanent.

### Pinecone — vector database
Purpose-built similarity search over the chunk embeddings. Kept separate from DynamoDB because vector search is a different operation than key lookup. It sits behind a thin adapter, so it could be swapped for AWS OpenSearch or Kendra without touching business logic.

### Google Gemini — embeddings
`gemini-embedding-001` turns text into vectors. The same model embeds both the document chunks (in `process`) and the question (in `query`) — they must match for similarity to be meaningful.

### Anthropic Claude — answer generation
Given the retrieved chunks + the question, Claude (`claude-haiku-4-5`) writes the answer and indicates which sources it used; citations are then built from the real chunk metadata. Bedrock is intentionally avoided; the Anthropic API is called directly.

## Data flow

**Upload:** Frontend → API Gateway → `upload` → S3 + DynamoDB (`uploaded`) → `documentId`.

**Process (automatic):** S3 `ObjectCreated` → `process` → extract → chunk (~500 tokens, 50 overlap) → Gemini embed → Pinecone upsert → DynamoDB (`ready`).

**Query:** Frontend → API Gateway → `query` → embed question → Pinecone top-5 → Claude(context + question) → `{ answer, citations[] }`.

**Delete:** Frontend → API Gateway → `delete` → Pinecone (by vector ID) + S3 + DynamoDB.

## Security model — least privilege

No single broad role. Each Lambda gets only what it uses:

- `upload` → `s3:PutObject` + `dynamodb:PutItem`
- `process` → `s3:GetObject` + `dynamodb:UpdateItem` (no `PutObject`, so it can't re-trigger itself)
- `query` → none (all data comes from Pinecone metadata + external APIs)
- `documents` → `dynamodb:Scan` + `dynamodb:GetItem` (read-only)
- `delete` → `s3:DeleteObject` + `dynamodb:GetItem`/`DeleteItem`

External API keys live only in Lambda environment variables — never in the frontend bundle or in Git. The API itself is gated by Cognito. If any one function were compromised, the blast radius is limited to its specific permissions.

## Design choices worth noting

- **Swappable adapters:** embeddings, vector store, and LLM are accessed through small modules toggled by `USE_REAL_*` flags, which also enable a $0 mock mode for local UI development.
- **Event-driven processing:** the S3 → Lambda trigger decouples upload from the slower embedding step, so the UI stays responsive and polls for status.
- **Cost posture:** S3, DynamoDB, Lambda, API Gateway, Amplify, Cognito, Pinecone, and Gemini all run within free tiers; Claude is the only paid call (sub-cent per query on Haiku).
