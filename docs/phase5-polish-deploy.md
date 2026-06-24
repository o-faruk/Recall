# Phase 5 — Polish & Deployment

This is the finale: put **API Gateway** in front of your Lambdas so the React app can call them over HTTPS, add the two **read endpoints** the frontend needs, flip the UI to **live mode**, and do a final **least-privilege IAM audit**.

💰 = cost note, ⚠️ = don't skip.

> Still effectively free: API Gateway's free tier is 1M calls/month (12 mo). The only paid call remains Claude (pennies on Haiku).

---

## 0. Concepts

- **API Gateway (REST):** the public HTTPS front door. Each URL path + method (e.g. `POST /query`) is forwarded to a Lambda. The browser can't call Lambda directly — this is what makes it reachable.
- **Lambda proxy integration:** API Gateway passes the raw HTTP request to your Lambda and returns whatever `{statusCode, headers, body}` the Lambda gives back. Your Lambdas already speak this format.
- **CORS:** browsers block a page on `localhost:5173` from calling a different origin (your API) unless the API explicitly allows it. We enable CORS so the frontend's `fetch` calls aren't blocked.
- **Stage:** a deployed snapshot of the API at a URL, e.g. `…/prod`.

---

## 1. Deploy the new `recall-documents` read Lambda

The frontend's document list + status polling need `GET /documents` and `GET /documents/{id}`. That's the new `recall-documents` function.

1. **IAM role:** IAM → Policies → Create policy → JSON → paste `infrastructure/iam-roles/documents-lambda-role.json` (replace `ACCOUNT_ID`). Name it `recall-documents-policy`. Then Roles → Create role → Lambda → attach `recall-documents-policy` + `AWSLambdaBasicExecutionRole`. Name it `recall-documents-role`.
2. **Function:** Lambda → Create function → `recall-documents`, Node.js 20.x, use existing role `recall-documents-role`.
3. **Code:** it has no dependencies, so you can paste `backend/functions/documents/index.js` inline (rename the file to `index.mjs` in the editor) **or** upload the tiny zip (`cd backend/functions/documents && npm run zip`).
4. **Env var:** `DYNAMO_TABLE_NAME` = `RecallDocuments`.
5. **Test** (Test tab):
   ```json
   { "requestContext": { "http": { "method": "GET" } } }
   ```
   should return `200` with a JSON array of your documents.

---

## 2. Create the REST API and wire the routes

1. **API Gateway → Create API → REST API → Build.** Name `recall-api`, Endpoint type Regional → Create.
2. Build this resource tree (Actions → Create Resource / Create Method). Use **Lambda Proxy integration** for every method (check "Use Lambda Proxy integration"):

   | Resource | Method | Lambda |
   |----------|--------|--------|
   | `/documents` | POST | `recall-upload` |
   | `/documents` | GET | `recall-documents` |
   | `/documents/{documentId}` | GET | `recall-documents` |
   | `/query` | POST | `recall-query` |

   To make `/documents/{documentId}`: select `/documents` → Create Resource → Resource name `documentId`, Resource path `{documentId}` (the braces make it a path variable) → then add the GET method on it.

   When you attach each method, API Gateway asks to add permission to invoke the Lambda — say yes.

> `recall-process` gets **no** route — it's triggered by the S3 upload event, not HTTP.

---

## 3. Enable CORS

For **each** resource (`/documents`, `/documents/{documentId}`, `/query`): select it → **Actions → Enable CORS** → keep defaults (it adds an `OPTIONS` method) → **Enable CORS and replace existing CORS headers**. Your Lambdas also return `Access-Control-Allow-*` headers, so both layers agree.

> ⚠️ For production you'd lock `Access-Control-Allow-Origin` to your real site instead of `*`. `*` is fine for local dev / a portfolio demo.

---

## 4. Deploy + get your URL

1. **Actions → Deploy API** → New stage → name `prod` → Deploy.
2. Copy the **Invoke URL** at the top — e.g. `https://abc123.execute-api.us-east-1.amazonaws.com/prod`. That's your `VITE_API_BASE_URL`.

---

## 5. Test the API directly (curl)

```bash
API=https://abc123.execute-api.us-east-1.amazonaws.com/prod

# list documents
curl "$API/documents"

# ask a question
curl -X POST "$API/query" -H "Content-Type: application/json" \
  -d '{"question":"What are the office hours?"}'
```
You should get your documents array and a `{ answer, citations[] }` object.

> ⚠️ Reminder: live `/query` only returns good results if your Pinecone index dimension matches your embedding model. If you switched to `gemini-embedding-001` (3072-dim), the `recall` index must be 3072 — otherwise you'll see a Pinecone dimension error. Recreate the index at the right dimension and re-upload a doc if needed.

---

## 6. Flip the frontend to live mode

1. `cd frontend`, copy `.env.example` → `.env.local`:
   ```
   VITE_USE_MOCK=false
   VITE_API_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod
   ```
2. `npm run dev`. Now upload a real PDF, watch it go **Ready** (real processing), and ask a question → real Claude answer with citations pulled from Pinecone. The "demo mode" pill disappears.

---

## 7. Final IAM least-privilege audit

Every Lambda has its own role granting only what it uses — no shared "god role." Confirm each role has exactly:

| Lambda | Custom policy | AWS-managed | Can it do anything else? |
|--------|---------------|-------------|--------------------------|
| `recall-upload` | `s3:PutObject` (bucket/raw/*) + `dynamodb:PutItem` (table) | Basic logs | No |
| `recall-process` | `s3:GetObject` (bucket/raw/*) + `dynamodb:UpdateItem` (table) | Basic logs | No (no PutObject → can't self-trigger) |
| `recall-query` | none (Pinecone/Claude/Gemini are API keys, not IAM) | Basic logs | No AWS data access at all |
| `recall-documents` | `dynamodb:Scan` + `dynamodb:GetItem` (table) | Basic logs | Read-only |

Audit checklist: open each role in IAM → confirm no `AdministratorAccess`, no `*` actions, no wildcard resources beyond the single bucket/table ARNs above. External API keys live only in Lambda env vars (never in IAM, never in Git).

---

## 8. Polish checklist (already in the code — verify)

- **Error handling:** every Lambda wraps work in try/catch and returns a clean `{error}` message (never a raw stack trace). The frontend shows errors in a banner / as an assistant message.
- **Loading states:** upload → animated status badges (Queued/Processing/Ready); ask → typing dots; initial doc load handled.
- **CORS:** enabled on all resources + returned by Lambdas.

---

## 9. Cost / free-tier recap (final)

| Service | Tier | Cost |
|---------|------|------|
| Lambda, S3, DynamoDB, API Gateway | free tier | 🟢 $0 |
| Pinecone (Starter), Gemini embeddings | free | 🟢 $0 |
| Anthropic Claude (Haiku) | pay per query | 💰 ~sub-cent each |

Your $1 AWS budget alert still guards the AWS side; watch your Anthropic balance for Claude.

---

## 10. (Optional, stretch) Host the frontend

`npm run build` produces `frontend/dist/`. To put it online: create a second S3 bucket with static website hosting (or use Netlify/Vercel/CloudFront). Set `VITE_API_BASE_URL` at build time. Then add a real demo GIF to the README. Not required for the project to be complete.
