# Phase 3 — RAG Query (going live)

This phase adds the `query` Lambda — the actual "ask a question, get a cited answer" step — and flips the embedding + vector + LLM services from mock to real.

Stack for this phase: **Google Gemini `text-embedding-004` (768-dim)** for embeddings (free tier), **Pinecone** (free tier) for vector search, **Anthropic `claude-haiku-4-5`** for answers. All three are called with the runtime's built-in `fetch()`, so there are **no npm packages to bundle**.

💰 = cost note, ⚠️ = don't skip.

> **This is the first phase that can cost money.** Pinecone and Gemini are free; only Claude charges (pennies per query on Haiku). Nothing calls a paid API until you set the keys and flip `USE_REAL_CLAUDE=true`. You can do the whole build in mock mode first for $0.

---

## 0. How a query flows

```
question
  -> embed with Gemini (768-dim vector)         [query Lambda]
  -> Pinecone search: top-5 nearest chunks       [query Lambda]
  -> build a prompt: those chunks as context
  -> Claude (haiku) writes a grounded answer     [query Lambda]
  -> return { answer, citations[] }
```

Citations are built from the **actual retrieved chunk metadata** (filename, chunkIndex, a text excerpt), not from whatever the model echoes — so they always point at real source text.

---

## 1. Get your three keys/values

1. **Gemini API key (free):** https://aistudio.google.com/apikey → Create API key. Copy it.
2. **Anthropic API key:** you already have one (~$3 credit). console.anthropic.com → API keys if you need it again.
3. **Pinecone (free):**
   - Sign up at pinecone.io (Starter/free plan).
   - **Create an index:** Name `recall`, **Dimension `768`**, Metric **cosine**, and pick the free serverless option (AWS us-east-1 is fine). ⚠️ The dimension MUST be 768 to match Gemini `text-embedding-004`.
   - After it's created, open the index and copy two things: the **API key** (from the API Keys tab) and the index **Host** (looks like `recall-xxxx.svc.aped-1234.pinecone.io`). For `PINECONE_HOST`, use it **without** `https://`.

> 💰 Free-tier check: Gemini embeddings free tier and Pinecone Starter are both $0. Only Claude costs — on Haiku, a top-5-chunk query is well under a cent.

---

## 2. Re-process your documents into REAL Pinecone vectors

Phase 2 only *mock*-embedded your chunks (it logged "would upsert" and stored nothing). To search for real, the `process` Lambda has to embed with Gemini and actually upsert to Pinecone. The code already supports this — you just flip its flags and reprocess.

1. **`recall-process` → Configuration → Environment variables → Edit.** Set/add:
   | Key | Value |
   |-----|-------|
   | `USE_REAL_EMBEDDINGS` | `true` |
   | `USE_REAL_PINECONE` | `true` |
   | `EMBEDDINGS_API_KEY` | your Gemini key |
   | `EMBEDDINGS_MODEL` | `text-embedding-004` |
   | `EMBEDDINGS_DIM` | `768` |
   | `PINECONE_API_KEY` | your Pinecone key |
   | `PINECONE_HOST` | your index host (no `https://`) |
   | `DYNAMO_TABLE_NAME` | `RecallDocuments` (already set) |
2. **Redeploy the process code** (it changed this phase to add the real branches): on your Mac
   ```bash
   cd ~/Documents/Projects/Recall/backend/functions/process
   npm install && npm run zip
   ```
   then `recall-process` → Code → Upload from ▼ → .zip file.
3. **Reprocess:** re-run your `recall-upload` test (the PDF). The new upload triggers `recall-process`, which now embeds with Gemini and upserts real vectors. CloudWatch should show `Processed "..." : N chunks` **without** the `[mock pinecone]` lines.
4. **Verify in Pinecone:** the index console should show vector count > 0.

---

## 3. Create the `query` Lambda

It has zero npm dependencies, so the zip is tiny (no `node_modules`).

1. Build it:
   ```bash
   cd ~/Documents/Projects/Recall/backend/functions/query
   npm run zip          # zips index.js + lib/ + package.json only
   ```
2. **IAM role:** IAM → Roles → Create role → Lambda → attach only **`AWSLambdaBasicExecutionRole`** (logs). The query Lambda needs no S3/DynamoDB access — see `infrastructure/iam-roles/query-lambda-role.json` for why. Name it `recall-query-role`.
3. **Lambda → Create function** → `recall-query`, Node.js 20.x, use existing role `recall-query-role`.
4. **Code → Upload from ▼ → .zip file** → your `function.zip`. (You'll see `index.js` + `lib/`, no `node_modules`.)
5. **Environment variables:**
   | Key | Value |
   |-----|-------|
   | `USE_REAL_EMBEDDINGS` | `true` |
   | `USE_REAL_PINECONE` | `true` |
   | `USE_REAL_CLAUDE` | `true` |
   | `EMBEDDINGS_API_KEY` | Gemini key |
   | `EMBEDDINGS_MODEL` | `text-embedding-004` |
   | `EMBEDDINGS_DIM` | `768` |
   | `PINECONE_API_KEY` | Pinecone key |
   | `PINECONE_HOST` | index host (no `https://`) |
   | `ANTHROPIC_API_KEY` | your Claude key |
   | `CLAUDE_MODEL` | `claude-haiku-4-5` |
6. **General configuration:** Memory 256 MB, Timeout 30 sec (Claude can take a few seconds).

> Tip: build + test the query Lambda with the three `USE_REAL_*` flags = `false` first. It'll return a mock answer + citation (no keys, no cost) and proves the wiring before you spend anything.

---

## 4. Test it (Lambda Test tab — API Gateway is Phase 5)

`recall-query` → **Test** → new event:
```json
{ "httpMethod": "POST", "body": "{\"question\":\"What are the office hours and how is the grade weighted?\"}" }
```
Run. A success is `statusCode 200` with a body like:
```json
{
  "answer": "Office hours are ... and grading is weighted ...",
  "citations": [
    { "documentId": "07fac320-...", "filename": "CSE3150-syllabus.pdf", "excerpt": "…", "chunkIndex": 1 }
  ]
}
```
To filter to specific documents, add `"documentIds": ["<id>"]` to the body.

**Debugging:** any failure shows in `recall-query`'s CloudWatch logs. Common ones: `PINECONE_HOST not set` (env typo), Pinecone `400` (index dimension ≠ 768), Anthropic `401` (bad key) or `400` about credit (out of the $3).

---

## 5. What's deployed vs local / cost

**New in AWS:** `recall-query` Lambda + `recall-query-role`. The `recall-process` Lambda now has real keys in its env.

**External (not AWS):** a Pinecone index (free), and your Gemini + Anthropic keys.

💰 **Cost posture now:** S3/DynamoDB/Lambda still in free tier; Pinecone + Gemini free; **Claude is the only paid call** (~sub-cent per query on Haiku). Your billing alert ($1) still guards AWS; watch your Anthropic balance for Claude.

⚠️ **Secret hygiene:** these keys live only in Lambda env vars and your local `.env` — never commit them. `.gitignore` already excludes `.env`.

---

## 6. Free-tier / cost summary

| Service | Phase 3 usage | Cost |
|---------|---------------|------|
| Lambda / S3 / DynamoDB | query + reprocess | 🟢 free tier |
| Pinecone | 1 index, small | 🟢 free (Starter) |
| Gemini embeddings | question + chunks | 🟢 free tier |
| Anthropic Claude | 1 answer per query | 💰 ~sub-cent (Haiku) |
