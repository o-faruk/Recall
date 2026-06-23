# Phase 1 — AWS Setup & Storage

This is the full, plain-English walkthrough for standing up Recall's storage layer and your first Lambda. Do the steps **in order**. Anything marked 💰 is a free-tier note; anything marked ⚠️ is a "don't skip this" safety step.

By the end of Phase 1 you will have: an AWS account secured properly, billing alerts, an S3 bucket, a DynamoDB table, and a working `upload` Lambda you can hit from a test event.

> **Region:** Use **`us-east-1` (N. Virginia)** for everything. Keep all resources in one region so they can talk to each other and so the free tier applies cleanly. Pick it from the top-right region dropdown in the console and don't change it.

---

## 0. Concepts you'll meet (read once, 2 min)

- **IAM (Identity and Access Management):** AWS's permission system. It controls *who* (users, roles) can do *what* (actions) on *which* resources. Everything in AWS is "deny by default" — you only get what's explicitly granted.
- **Root user:** the email you signed up with. It can do *everything*, including close the account and change billing. You use it once to set up, then lock it away and never use it again.
- **IAM user:** a day-to-day login with only the permissions it needs. You'll work as this, not root.
- **IAM role:** like a user, but *assumed* by a service (e.g. a Lambda) instead of a person. The role is how a Lambda gets permission to touch S3/DynamoDB — without any access keys baked into code.
- **Lambda:** a function that runs on-demand in the cloud. No server to manage. You upload code; AWS runs it when triggered (by API Gateway, an S3 event, etc.) and you pay per request and per millisecond of run time.
- **S3 (Simple Storage Service):** object storage — basically infinite, durable "buckets" of files. Recall stores raw uploaded documents here.
- **DynamoDB:** a fast NoSQL key-value/document database. Recall stores one metadata row per document here.
- **Partition key:** DynamoDB's primary key. It decides which physical partition a row lives on, and it's how you fetch a row directly. Ours is `documentId` — unique per document, so lookups are O(1).

---

## 1. Create + secure the AWS account

1. Go to **aws.amazon.com → Create an AWS Account**. You'll need an email, a credit card (required even for free tier — they verify with a small temporary hold), and a phone number.
2. Choose the **Basic support — Free** plan when asked.
3. Sign in to the **AWS Management Console** as the **root user** (the email you just used).

### ⚠️ 1a. Turn on MFA for the root user (do this now)
1. Top-right, click your account name → **Security credentials**.
2. Under **Multi-factor authentication (MFA)** → **Assign MFA device**.
3. Pick **Authenticator app**, scan the QR with Google Authenticator / Authy / 1Password, enter two consecutive codes. Done.

This means even if your password leaks, nobody can use the all-powerful root account without your phone.

---

## 2. 💰 Billing alerts (do this before building anything)

You said you'd set these up day one — here's exactly what to do.

### 2a. Enable billing alerts
1. Root menu (top-right) → **Billing and Cost Management**.
2. Left sidebar → **Billing preferences** → enable **"Receive AWS Free Tier alerts"** and enter your email (`omarfarukk108@gmail.com`). Save.

### 2b. Create a Budget with email alerts
1. In Billing and Cost Management → **Budgets** → **Create budget**.
2. Choose **Customize (advanced)** → **Cost budget**.
3. **Period:** Monthly. **Budget amount:** set it to **$1.00**.
   - *Why $1 and not $0?* AWS budgets need a positive number, and a $1 ceiling means you get pinged the instant anything starts costing real money — long before it matters.
4. Add **alert thresholds** (you can add several):
   - **Actual cost ≥ 50%** of $1 (i.e. $0.50) → email you.
   - **Actual cost ≥ 100%** ($1.00) → email you.
   - **Forecasted cost ≥ 100%** → email you (warns you *before* you hit it).
5. Recipient: your email. Create.

> 🔔 **Recommended threshold to set: $1 budget, with alerts at $0.50 and $1.** If you ever get one of these emails during this project, stop and investigate — at portfolio scale you should be at $0.00.

---

## 3. Create your IAM user (stop using root)

You'll do all real work as this user.

1. Console → search **IAM** → open it.
2. Left sidebar → **Users** → **Create user**.
3. **User name:** `omar-dev`.
4. Check **"Provide user access to the AWS Management Console"** → **"I want to create an IAM user"** → set a password. (You can uncheck "force password reset" since it's just you.)
5. **Permissions:** for Phase 1, attach the AWS-managed policy **`AdministratorAccess`** *for now* by selecting **"Attach policies directly."**
   - ⚠️ This is broad on purpose — it lets *you* (the human) create buckets, tables, and roles during setup. It is **not** the same as the Lambda god-role you're avoiding. The *Lambdas* will get tiny scoped roles (Section 7). Tightening your own user is an optional later step; many solo devs keep an admin user behind MFA.
6. Finish creating. On the final screen, note the **console sign-in URL** (looks like `https://<account-id>.signin.aws.amazon.com/console`). Save it.

### ⚠️ 3a. MFA on the IAM user too
IAM → Users → `omar-dev` → **Security credentials** → **Assign MFA device** → authenticator app. Same as before.

### 3b. Sign out of root, sign in as `omar-dev`
From here on, **use `omar-dev`** via that sign-in URL. Only return to root for billing-level changes.

---

## 4. Create the S3 bucket (raw document storage)

1. Console → **S3** → **Create bucket**.
2. **Bucket name:** must be globally unique. Use something like **`recall-documents-omar-2026`**. (If taken, add digits.) Whatever you choose, put it in `.env` as `S3_BUCKET_NAME` and update the two infra JSON files.
3. **Region:** US East (N. Virginia) `us-east-1`.
4. **Block Public Access:** ⚠️ leave **ALL FOUR boxes checked (ON)**. Your documents are private; nothing should ever be publicly readable.
5. **Bucket Versioning:** **Enable**. (If a document is re-uploaded with the same key, you can recover the old version. Also a good story in interviews about durability.)
6. **Default encryption:** leave the default (SSE-S3, server-side encryption) **on**. It's free.
7. Create the bucket.

### 4a. (Optional, defense-in-depth) attach the HTTPS-only bucket policy
1. Open the bucket → **Permissions** → **Bucket policy** → **Edit**.
2. Paste the contents of `infrastructure/s3-policy.json` (replace the bucket name with yours). Save.
   - This denies any non-HTTPS request. Block Public Access is still your main control.

> 💰 **Free tier:** 5 GB storage + 2,000 PUT + 20,000 GET requests/month for 12 months. A few test PDFs is nothing. ⚠️ *Risk to watch:* versioning means old versions also count toward storage — fine for you, just don't upload gigabytes.

---

## 5. Create the DynamoDB table (metadata)

1. Console → **DynamoDB** → **Tables** → **Create table**.
2. **Table name:** `RecallDocuments`.
3. **Partition key:** `documentId`, type **String**.
4. **Sort key:** leave **empty** — we look documents up by id alone, so we don't need one.
5. **Table settings:** choose **Customize settings**.
6. **Capacity / table class:** set **Read/write capacity** to **On-demand (PAY_PER_REQUEST)**.
   - *Why on-demand?* You pay only per request with zero idle cost, and it never needs tuning. Perfect for spiky portfolio traffic.
7. Create table.

You do **not** predefine `filename`, `status`, etc. DynamoDB only needs the key attribute declared; every other field is written freely by the Lambda. (This is exactly what `infrastructure/dynamo-schema.json` documents.)

> 💰 **Free tier:** 25 GB storage + 25 WCU + 25 RCU equivalent / month — **permanent**, not 12-month. You will not get near this.

---

## 6. Create the upload Lambda

### 6a. First, create its execution role (Section 7) — then come back here.
Do **Section 7** now, then return. A Lambda must have a role at creation time.

### 6b. Good news — no zip needed for Phase 1
The Node.js 20.x Lambda runtime already ships with the AWS SDK v3 (`@aws-sdk/*`), which is the only thing this function imports. So you can paste the code straight into the console's built-in editor — no terminal, no `npm install`, no zip. (You'll only need the zip path later, in Phase 2, when `process` uses a library the runtime doesn't include, like `pdf-parse`.)

### 6c. Create the function
1. Console → **Lambda** → **Create function** → **Author from scratch**.
2. **Function name:** `recall-upload`.
3. **Runtime:** **Node.js 20.x**.
4. **Architecture:** arm64 (slightly cheaper/faster) or x86_64 — either is fine.
5. **Permissions** → **Change default execution role** → **Use an existing role** → pick **`recall-upload-role`** (created in Section 7).
6. Create function.

### 6d. Add your code (inline — the easy way)
1. On the function page → **Code** tab. There's a file tree on the left with **`index.mjs`** open in the editor.
2. Select all the placeholder code in it, delete it, then open `backend/functions/upload/index.js` from this repo, copy the whole file, and paste it in.
   - ⚠️ The file must be named **`index.mjs`** (the `.mjs` extension is what lets Lambda run the `import`/`export` syntax this code uses). If the editor shows `index.js`, right-click it → Rename → `index.mjs`. Leave the handler set to `index.handler`.
3. Click the orange **Deploy** button to save. You should see "Changes deployed."

> Alternative (not needed now): upload a zip via **Upload from → .zip file**, built with `cd backend/functions/upload && npm install && npm run zip`.

### 6e. Set environment variables
- **Configuration** tab → **Environment variables** → **Edit** → add:
  - `S3_BUCKET_NAME` = `recall-documents-omar-2026`
  - `DYNAMO_TABLE_NAME` = `RecallDocuments`
- (`AWS_REGION` is provided automatically by Lambda — no need to set it.)

### 6f. Bump the basics
- **Configuration → General configuration → Edit:** Timeout **10 sec**, Memory **256 MB**. Plenty for an upload, still tiny on cost.

> 💰 **Free tier:** 1M requests + 400,000 GB-seconds/month — **permanent**. At 256 MB, that's ~1.5M seconds of run time free monthly. Untouchable at portfolio scale.

---

## 7. The least-privilege IAM role for the upload Lambda

This is the heart of your "no god-role" design.

1. Console → **IAM** → **Policies** → **Create policy** → **JSON** tab.
2. Paste the contents of `infrastructure/iam-roles/upload-lambda-role.json`.
   - ⚠️ Replace **`ACCOUNT_ID`** with your 12-digit account number (top-right menu → it's shown there), and the bucket/table names if you changed them.
   - It grants exactly two things: `s3:PutObject` on `…/raw/*` and `dynamodb:PutItem` on the table. Nothing else.
3. Name it **`recall-upload-policy`** → Create.
4. **IAM → Roles → Create role** → **Trusted entity: AWS service** → **Lambda** → Next.
5. Attach **two** policies:
   - **`recall-upload-policy`** (the one you just made).
   - **`AWSLambdaBasicExecutionRole`** (AWS-managed — lets the function write logs to CloudWatch so you can debug). This grants logs only, nothing else.
6. **Role name:** `recall-upload-role` → Create.

Now go back and finish **Section 6**.

---

## 8. Test it (no frontend needed yet)

You'll send a tiny base64 text file straight into the Lambda using a test event.

1. Make a base64 string of a test file on your Mac:
   ```bash
   echo "Hello Recall, this is a test document." | base64
   ```
   Copy the output.
2. Lambda console → `recall-upload` → **Test** tab → **Create new event**.
3. Paste this JSON, dropping your base64 into `fileData`:
   ```json
   {
     "httpMethod": "POST",
     "body": "{\"filename\":\"test.txt\",\"fileType\":\"text/plain\",\"fileData\":\"PASTE_BASE64_HERE\"}"
   }
   ```
4. Click **Test**. ✅ A success looks like:
   ```json
   { "statusCode": 201, "body": "{\"documentId\":\"...\",\"status\":\"uploaded\",\"filename\":\"test.txt\"}" }
   ```
5. **Verify the side effects:**
   - **S3:** open the bucket → you should see `raw/<documentId>.txt`.
   - **DynamoDB:** Tables → `RecallDocuments` → **Explore table items** → you should see a row with that `documentId` and `status: "uploaded"`.

If `statusCode` is 500, open the **Monitor → View CloudWatch logs** to read the error. The most common cause is the role missing a permission or an env var typo.

> Note: this Phase ends at the Lambda's Test tab. **API Gateway is Phase 5 wiring** (so the React app can call it over HTTPS). You don't need it to prove the storage flow works.

---

## 9. What's deployed to AWS vs. just local code

**Live in AWS after Phase 1 (these can theoretically cost money — but won't at this scale):**
- AWS account + IAM users (`omar-dev`) and role (`recall-upload-role`)
- Billing budget + alerts
- S3 bucket `recall-documents-omar-2026`
- DynamoDB table `RecallDocuments`
- Lambda function `recall-upload`

**Local code only (in this repo, NOT deployed):**
- Everything in `frontend/`
- `backend/functions/process` and `backend/functions/query` (empty until Phases 2–3)
- All `infrastructure/*.json` files (these are *source of truth you copy into the console* — they don't auto-apply)

**Nothing here runs on a schedule or idles.** S3 and DynamoDB only cost for what they store (kilobytes), Lambda only costs when invoked. There are **no orphaned always-on resources** to forget about. If you ever want to fully tear down: delete the Lambda, empty + delete the bucket, delete the table. (Keep the budget.)

---

## 10. Free-tier risk summary for Phase 1

| Service   | Free tier                                  | Phase 1 risk | Watch out for |
|-----------|--------------------------------------------|--------------|----------------|
| S3        | 5 GB + 2k PUT + 20k GET / mo (12 mo)       | 🟢 none      | Versioning keeps old copies; don't bulk-upload |
| DynamoDB  | 25 GB + 25 R/W CU / mo (permanent)         | 🟢 none      | On-demand mode = no idle cost |
| Lambda    | 1M req + 400k GB-s / mo (permanent)        | 🟢 none      | Infinite loops / huge memory (you set 256 MB) |
| IAM       | free                                       | 🟢 none      | — |
| Budgets   | 2 budgets free                             | 🟢 none      | — |

You are at **$0.00** for Phase 1 the whole way through.
