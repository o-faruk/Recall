# Phase 4 — React Frontend

The dark UI from the mockup, built for real with React + Vite. It has a **demo mode** so you can run the whole thing locally with no backend ($0) and a **live mode** that talks to the real API once API Gateway is wired in Phase 5.

## What's here

```
frontend/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
└── src/
    ├── main.jsx          # React entry
    ├── App.jsx           # state: documents, messages, polling, send
    ├── api.js            # mock + live backend behind one VITE_USE_MOCK toggle
    ├── styles.css        # dark JARVIS theme
    └── components/
        ├── UploadPanel.jsx   # drag-drop / click upload
        ├── DocumentList.jsx  # docs + status badges, click to scope queries
        ├── ChatPanel.jsx     # messages, streaming-style typing dots, composer
        └── CitationCard.jsx  # expandable source cards
```

## Run it (demo mode — no backend needed)

```bash
cd ~/Documents/Projects/Recall/frontend
npm install
npm run dev
```
Vite opens http://localhost:5173. In demo mode you can:
- Drag a file (or click) into the upload zone → watch the badge go **Queued → Processing → Ready** (simulated).
- Click a document to scope your questions to it (click again to clear).
- Type a question → see the typing dots, then a demo answer with **expandable citation cards**.

Demo mode is controlled by `VITE_USE_MOCK` (defaults to `true`). All fake data lives in `src/api.js` — components never call the network directly.

## Going live (after Phase 5)

1. Copy `.env.example` to `.env.local` and set:
   ```
   VITE_USE_MOCK=false
   VITE_API_BASE_URL=https://<your-api-id>.execute-api.us-east-1.amazonaws.com/prod
   ```
2. `npm run dev` (or `npm run build` for a production bundle in `dist/`).

The live API layer expects these endpoints (wired in Phase 5):
- `POST /documents` — upload (already exists: the upload Lambda).
- `POST /query` — ask (already exists: the query Lambda).
- `GET /documents` and `GET /documents/{id}` — list + status polling. **These two are small read endpoints we still need to add in Phase 5** (a DynamoDB Scan and GetItem). Demo mode simulates them so the UI is fully testable now.

## Build check

```bash
npm run build      # type-free Vite build -> dist/
```

## Deployed vs local / cost

Nothing here is deployed to AWS yet — it's a local dev app. Hosting the built `dist/` (e.g. S3 + CloudFront, or any static host) is a Phase 5 / stretch step. Demo mode is **$0**; live mode only spends on the same Claude calls from Phase 3.
