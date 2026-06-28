# Recall

**RAG-powered document search on AWS.** Upload PDFs or text files, ask questions in plain English, and get accurate, AI-generated answers — each one backed by citations that point to the exact source document and excerpt.

Recall is a full Retrieval-Augmented Generation pipeline: documents are stored in S3, tracked in DynamoDB, embedded into vectors in Pinecone, and answered by Anthropic's Claude with grounded citations. The React frontend is hosted on AWS Amplify and protected by Amazon Cognito login.

> Built by **Omar Faruk** — University of Connecticut, CS (AI/ML concentration).

**Live demo:** https://main.dszwahkc94maj.amplifyapp.com *(access-restricted — login required; credentials available on request)*

---

## Features

- **Semantic search, not keywords** — ask "when can I meet the professor?" and it finds "office hours are Tuesdays," even with no shared words.
- **Grounded answers with citations** — every answer links back to the source file and the exact excerpt it used, so nothing is unverifiable.
- **Live processing status** — uploads show animated `Queued → Processing → Ready` badges as they're parsed, chunked, and embedded.
- **Scoped questions** — ask across all documents or filter to a single one.
- **Authenticated & cost-safe** — the site and the API both require login (Cognito), so the backend can't be hit anonymously.

---

## Architecture

```
                ┌──────────────────────────────┐
                │   React SPA (Vite)           │
                │   hosted on AWS Amplify      │
                └───────────────┬──────────────┘
              Cognito login ►   │  HTTPS request + JWT
                ┌───────────────▼──────────────┐
                │   API Gateway (REST)         │
                │   + Cognito authorizer       │
                └───────────────┬──────────────┘
        ┌──────────┬────────────┼────────────┬───────────┐
        ▼          ▼            ▼            ▼           ▼
     upload    documents      query       delete    process*
     Lambda     Lambda       Lambda       Lambda     Lambda
        │          │            │            │           │  *invoked by the
        ▼          ▼            ▼            ▼           ▼   S3 upload event
   S3 + DynamoDB  DynamoDB   Pinecone +   S3 + DDB +  Gemini embeddings
   (raw + meta)   (read)     Claude       Pinecone    → Pinecone, DDB→ready
```

Each Lambda has its **own least-privilege IAM role** — no shared "god role." API keys (Gemini, Anthropic, Pinecone) live only in Lambda environment variables, never in the frontend or in Git. A deeper write-up is in [`architecture.md`](./architecture.md).

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite, hosted on **AWS Amplify** (CI/CD from GitHub) |
| Auth | **Amazon Cognito** user pool + API Gateway Cognito authorizer |
| API | AWS API Gateway (REST) |
| Compute | AWS Lambda (Node.js 20.x) — `upload`, `process`, `query`, `documents`, `delete` |
| Document storage | AWS S3 (versioned, all public access blocked) |
| Metadata DB | AWS DynamoDB |
| Vector DB | Pinecone |
| Embeddings | Google Gemini (`gemini-embedding-001`) |
| LLM | Anthropic Claude (`claude-haiku-4-5`) |
| Security | Per-Lambda least-privilege IAM roles |

---

## How it works

1. **Upload** → the `upload` Lambda stores the raw file in S3 and writes a metadata row to DynamoDB (`status: uploaded`).
2. **Process** (automatic) → the S3 upload event triggers the `process` Lambda, which extracts text, splits it into ~500-token overlapping chunks, embeds each chunk with Gemini, upserts the vectors to Pinecone, and flips the status to `ready`.
3. **Ask** → the `query` Lambda embeds the question, retrieves the top-5 nearest chunks from Pinecone, and asks Claude to answer using only those chunks — returning `{ answer, citations[] }` where each citation maps back to a real source excerpt.

External services (embeddings, vector store, LLM) sit behind thin adapter modules, so the vector DB or model can be swapped (e.g. to AWS OpenSearch) without touching business logic.

---

## Local development

The frontend has a **demo mode** that simulates the backend, so you can run the whole UI with no AWS account and $0:

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 in demo mode
```

To run against the real backend, copy `frontend/.env.example` → `.env.local`, set `VITE_USE_MOCK=false` plus your API URL and Cognito IDs. Backend Lambda environment variables are documented in [`.env.example`](./.env.example). Real keys are never committed — `.gitignore` excludes all `.env*` files except the examples.

---

## Repository structure

```
Recall/
├── frontend/              # React (Vite) app — UI, Cognito auth, API client
├── backend/functions/
│   ├── upload/            # POST /documents       → S3 + DynamoDB
│   ├── process/           # S3 trigger            → extract, chunk, embed, Pinecone
│   ├── query/             # POST /query           → embed, search, Claude, citations
│   ├── documents/         # GET /documents (+/{id}) → list + status
│   └── delete/            # DELETE /documents/{id} → Pinecone + S3 + DynamoDB
├── infrastructure/        # IAM policies, S3 policy, DynamoDB schema, API routes
└── architecture.md        # design write-up
```

---

## License

Personal portfolio project. © 2026 Omar Faruk.
