# Phase 2 — Processing Pipeline

This phase adds the `process` Lambda: it wakes up automatically whenever a file lands in S3, extracts and chunks the text, generates (mock) embeddings, "stores" them (mock Pinecone), and flips the document's DynamoDB status to `ready`.

Do the steps in order. 💰 = free-tier note, ⚠️ = don't skip.

> Everything here stays at **$0**. Embeddings and Pinecone are mocked; only S3, DynamoDB, and Lambda are touched, all far inside their free tiers.

---

## 0. New concepts in this phase

- **Event-driven trigger:** instead of you calling the function, S3 emits an `ObjectCreated` event when a file is uploaded, and that event *invokes* the Lambda. The upload Lambda's job ends at "file saved"; processing happens on its own in the background.
- **Deployment package (zip):** Phase 1's upload Lambda used only the AWS SDK (already in the runtime), so you pasted code. `process` uses `pdf-parse`, which is **not** in the runtime — so you bundle your code + `node_modules` into a `.zip` and upload that.
- **Chunk overlap:** chunks overlap by ~50 tokens so an idea sitting on a chunk boundary lives fully inside at least one chunk — this keeps retrieval accurate.
- **Mock adapters:** `lib/embeddings.js` and `lib/vectorstore.js` are the only files that talk to external AI services. They're mocked now and flip to real in Phase 3 via the `USE_REAL_*` env flags — no other code changes.

---

## 1. Create the IAM role (`recall-process-role`)

Same pattern as Phase 1, different permissions.

1. **IAM → Policies → Create policy → JSON.** Paste `infrastructure/iam-roles/process-lambda-role.json`.
   - ⚠️ Replace `ACCOUNT_ID`, and the bucket/table names if yours differ.
   - It grants exactly `s3:GetObject` on `…/raw/*` and `dynamodb:UpdateItem` on the table. No `PutObject` (so it can't trigger itself), no `PutItem`.
2. Name it **`recall-process-policy`** → Create.
3. **IAM → Roles → Create role → AWS service → Lambda.** Attach **`recall-process-policy`** + **`AWSLambdaBasicExecutionRole`** (logs).
4. Role name: **`recall-process-role`** → Create.

---

## 2. Build the deployment zip (on your Mac)

```bash
cd ~/Documents/Projects/Recall/backend/functions/process
npm install          # installs pdf-parse into node_modules
npm run zip          # creates function.zip (index.js + lib/ + package.json + node_modules)
```

You should end up with a `function.zip` of roughly 1–3 MB. (`function.zip` is git-ignored, so it won't be committed.)

> ⚠️ If `npm run zip` says `zip: command not found`, run `brew install zip` first (rare on macOS — it's usually preinstalled).

---

## 3. Create the function

1. **Lambda → Create function → Author from scratch.**
2. Function name: **`recall-process`**.
3. Runtime: **Node.js 20.x**.
4. **Change default execution role → Use an existing role → `recall-process-role`.**
5. Create function.
6. **Code tab → Upload from → .zip file →** choose your `function.zip` → Save.
   - The handler stays **`index.handler`** (default). `package.json` has `"type": "module"`, so the `import`/`export` syntax works.

---

## 4. Environment variables

**Configuration → Environment variables → Edit → Add:**

| Key | Value |
|-----|-------|
| `DYNAMO_TABLE_NAME` | `RecallDocuments` |
| `USE_REAL_EMBEDDINGS` | `false` |
| `USE_REAL_PINECONE` | `false` |
| `EMBEDDINGS_DIM` | `1536` |

(Optional: `CHUNK_TOKENS=500`, `CHUNK_OVERLAP=50` — the code already defaults to these.)

---

## 5. Bump memory + timeout (⚠️ needed for PDFs)

**Configuration → General configuration → Edit:** Memory **512 MB**, Timeout **30 sec**. PDF parsing needs more headroom than a plain upload.

> 💰 Still free: 512 MB × 30 s is well within the permanent 400,000 GB-seconds/month allowance even after thousands of documents.

---

## 6. Wire the S3 trigger (the automatic part)

1. On the `recall-process` function page → **+ Add trigger**.
2. Source: **S3**.
3. Bucket: your `recall-documents-omar-2026`.
4. Event types: **All object create events** (`s3:ObjectCreated:*`).
5. **⚠️ Prefix:** `raw/` — this is important. It means only files under `raw/` trigger processing, and protects you against accidental re-trigger loops.
6. Acknowledge the recursive-invocation warning checkbox (safe here — this Lambda never writes back to S3) → **Add**.

AWS automatically grants S3 permission to invoke the function.

---

## 7. Test it end-to-end

The cleanest test reuses your Phase 1 upload Lambda so both the S3 object **and** the DynamoDB row get created (which then fires `process` automatically).

1. Base64-encode a small PDF on your Mac:
   ```bash
   base64 -i ~/Desktop/test.pdf | tr -d '\n' | pbcopy
   ```
   (Any small text-based PDF works. `pbcopy` puts it on your clipboard.)
2. **Lambda → `recall-upload` → Test tab.** Use this event, pasting the base64 into `fileData`:
   ```json
   {
     "httpMethod": "POST",
     "body": "{\"filename\":\"test.pdf\",\"fileType\":\"application/pdf\",\"fileData\":\"PASTE_BASE64_HERE\"}"
   }
   ```
3. Run it → you get a `201` + `documentId` (Phase 1 behavior). S3 now has `raw/<id>.pdf`, which **automatically triggers `recall-process`**.
4. **Verify the magic:**
   - **DynamoDB → Explore table items:** within a few seconds the row's `status` goes `uploaded → processing → ready`, and `chunkCount` becomes a real number.
   - **CloudWatch:** `recall-process` → **Monitor → View CloudWatch logs** → latest log stream. You should see `[mock pinecone] would upsert N vectors`, a sample vector with `dim=1536`, and `Processed "test.pdf": N chunks.`

> Quicker alternative: drag a PDF directly into the bucket's `raw/` folder in the S3 console. `process` still runs and chunks it (it derives the id from the filename), but no upload-Lambda row is created first — so use the upload-Lambda path above for a true end-to-end test.

**If status flips to `error`:** open the row — the `errorMessage` field says why (e.g. unsupported type, or an image-only PDF with no extractable text). CloudWatch has the full stack trace.

---

## 8. What's deployed to AWS vs. just local code

**New in AWS after Phase 2:**
- `recall-process-role` (IAM role + `recall-process-policy`)
- `recall-process` Lambda (+ its env vars)
- An **S3 → Lambda trigger** (event notification on the bucket, prefix `raw/`)

**Local code only:** the React frontend, the `query` Lambda (still a stub), `lib/embeddings.js` + `lib/vectorstore.js` (deployed *inside* the process zip, but they live in the repo), and all `infrastructure/*.json`.

**Still no always-on resources.** The process Lambda only runs when a file is uploaded. To fully tear down later: remove the S3 trigger, delete `recall-process`, delete the role/policy.

---

## 9. Free-tier risk summary

| Service   | What Phase 2 uses                | Risk | Note |
|-----------|----------------------------------|------|------|
| Lambda    | 512 MB × ~a few sec per file     | 🟢   | Permanent free tier; nowhere close |
| S3        | 1 GetObject per uploaded file    | 🟢   | 20k GET/mo free (12 mo) |
| DynamoDB  | 3 UpdateItem per file            | 🟢   | Permanent free tier |
| Pinecone  | none (mocked)                    | 🟢   | First real calls are Phase 3 |
| Embeddings| none (mocked)                    | 🟢   | First real calls are Phase 3 |

⚠️ The only theoretical risk is a **trigger loop** (a Lambda that writes to the bucket that triggers it). We avoid it two ways: `process` has no `s3:PutObject` permission, and the trigger is scoped to the `raw/` prefix only. You're safe.

You remain at **$0.00** through Phase 2.
