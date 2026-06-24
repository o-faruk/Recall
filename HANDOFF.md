# Recall — Phase 5 Handoff

**Project:** RAG-powered document search on AWS (full stack: React frontend + Lambda backend + DynamoDB + S3 + Pinecone + Claude)

**Status:** Phase 5 in progress — API Gateway + delete endpoint mostly working, but **DELETE/CORS failing** and **menu UI needs styling fix**.

---

## Current State

### ✅ What Works
- **Frontend (React + Vite)** running at http://localhost:5173 in live mode
- **Upload endpoint** (POST /documents) — uploads PDFs to S3, creates DynamoDB records
- **Process Lambda** (S3 trigger) — extracts text, chunks, embeds with Gemini, stores in Pinecone
- **Query endpoint** (POST /query) — searches Pinecone, generates Claude answers with citations
- **Document list endpoint** (GET /documents, GET /documents/{id}) — reads from DynamoDB
- **API Gateway** (prod stage) deployed at `https://0dief5kwu3.execute-api.us-east-1.amazonaws.com/prod`
- **Delete Lambda** created and wired, works via curl
- **Delete UI menu** added to frontend (⋯ button on each doc)

### ❌ What's Broken
1. **DELETE endpoint CORS issue** — `"Delete failed: Failed to fetch"` from browser. Curl works, but browser request blocked.
   - **Root cause:** CORS not properly enabled for DELETE method on `/documents/{documentId}` resource in API Gateway
   - **Fix:** API Gateway → recall-api → /documents/{documentId} → Actions → Enable CORS → check DELETE → Deploy to prod
   
2. **Delete menu styling** — opacity/visibility issues, looks unclear
   - **Fix:** Update `.docrow-menu*` CSS in `frontend/src/styles.css` (CSS provided in last message)

### ⚠️ Known Issues
- **Gemini quota exhausted** — 4 PDFs failed with 429 error (quota resets midnight PT / 8am UTC)
- **Frontend .env.local** set to live mode:
  ```
  VITE_USE_MOCK=false
  VITE_API_BASE_URL=https://0dief5kwu3.execute-api.us-east-1.amazonaws.com/prod
  ```

---

## Key Files & Configs

### Backend (AWS Lambda functions)
- `backend/functions/upload/index.js` — POST /documents handler
- `backend/functions/process/index.js` — S3 event processor
- `backend/functions/query/index.js` — POST /query handler
- `backend/functions/documents/index.js` — GET /documents handlers
- `backend/functions/delete/index.js` — DELETE /documents/{id} handler (newly added)

### Frontend (React)
- `frontend/src/App.jsx` — main app, handles upload/delete/query
- `frontend/src/components/DocumentList.jsx` — sidebar with doc list + delete menu (⋯ button)
- `frontend/src/api.js` — API client layer (mock + live modes)
- `frontend/src/styles.css` — dark UI theme
- `frontend/.env.local` — live mode config (VITE_USE_MOCK=false, VITE_API_BASE_URL=...)

### Infrastructure
- `infrastructure/iam-roles/` — least-privilege IAM policies for each Lambda
- `infrastructure/api-gateway-config.json` — reference doc for routes (not auto-applied)

### Env Vars (set in Lambda)
- All Lambdas: `DYNAMO_TABLE_NAME=RecallDocuments`, `S3_BUCKET_NAME=recall-documents`
- Process & Query: `PINECONE_API_KEY`, `PINECONE_INDEX_NAME=recall`, `EMBEDDINGS_API_KEY` (Gemini), `LLM_API_KEY` (Anthropic)
- Process & Query: `USE_REAL_EMBEDDINGS=true` (for real Gemini, false for mock)

---

## Immediate Next Steps (Priority Order)

1. **Fix CORS for DELETE (5 min)**
   - API Gateway → recall-api → /documents/{documentId} → Actions → Enable CORS
   - Verify DELETE method is checked
   - Deploy to prod stage
   - Test: `curl -X DELETE https://0dief5kwu3.execute-api.us-east-1.amazonaws.com/prod/documents/<DOC_ID>` (should return `{"message":"Document deleted successfully"}`)

2. **Improve delete menu styling (2 min)**
   - Edit `frontend/src/styles.css`
   - Replace `.docrow-menu*` CSS rules with improved version (provided in last message)
   - Save and refresh browser

3. **Test delete in UI**
   - Reload http://localhost:5173
   - Click ⋯ menu on any document → Delete
   - Should vanish immediately

4. **Wait for Gemini quota reset**
   - Midnight PT / 8am UTC
   - Then re-upload failed PDFs (Chapter Eight, Seven, Four, Three)

5. **Commit Phase 5**
   ```bash
   cd ~/Documents/Projects/Recall
   git add . && git commit -m "Phase 5: API Gateway + delete endpoint + menu UI" && git push
   ```

---

## How to Run

```bash
# Terminal 1: Frontend
cd ~/Documents/Projects/Recall/frontend
npm run dev
# Opens http://localhost:5173

# Backend: Already deployed to AWS (Lambdas, API Gateway, databases)
# No local backend to run
```

---

## Testing Workflow

1. **Upload a PDF** → watch it turn Ready (2-3 sec for real processing)
2. **Ask a question** → get Claude answer with citations
3. **Delete a document** → click ⋯ → Delete (once CORS is fixed)
4. **Check status** — run curl tests:
   ```bash
   API=https://0dief5kwu3.execute-api.us-east-1.amazonaws.com/prod
   curl "$API/documents"  # List all
   curl -X DELETE "$API/documents/<DOC_ID>"  # Delete
   ```

---

## Architecture Summary

```
React Frontend (localhost:5173)
    ↓ HTTPS (REST)
API Gateway (prod stage) — routes to Lambdas
    ├→ upload Lambda → S3 + DynamoDB
    ├→ process Lambda (S3 trigger) → Pinecone + Gemini
    ├→ query Lambda → Pinecone + Claude + answer
    ├→ documents Lambda → DynamoDB read
    └→ delete Lambda → S3 + DynamoDB + Pinecone cleanup
```

---

## Git Status

- All code committed to `main` branch
- Phase 5 commit pending (after fixes)
- Uncommitted: Frontend hot-reload changes (harmless, will be overwritten on restart)

---

## Contact / Notes

- User: Omar Faruk (omarfarukk108@gmail.com)
- Project: Portfolio piece for CS junior internship (AI/cloud focus)
- Slack/Discord: N/A — local dev only
- Timeline: Ongoing (quota waits, then final test)
