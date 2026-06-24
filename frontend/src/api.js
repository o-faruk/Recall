// ----------------------------------------------------------------------
// Recall — frontend API layer
// One toggle decides everything:
//   VITE_USE_MOCK=true  -> fully simulated backend (run the UI with no AWS, $0)
//   VITE_USE_MOCK=false -> calls the real API at VITE_API_BASE_URL (Phase 5)
//
// Keeping all network logic here means the components never change when you
// flip from mock to live.
// ----------------------------------------------------------------------

const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";
const BASE = import.meta.env.VITE_API_BASE_URL || "";

// ---- helpers -----------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",").pop());
    r.onerror = reject;
    r.readAsDataURL(file);
  });

// ======================================================================
// MOCK backend — simulates upload + async processing + a cited answer.
// ======================================================================
const mockDocs = new Map(); // documentId -> { ...meta, _createdAt }

function mockStatus(doc) {
  const elapsed = Date.now() - doc._createdAt;
  if (elapsed < 1500) return { status: "uploaded", chunkCount: 0 };
  if (elapsed < 3500) return { status: "processing", chunkCount: 0 };
  return { status: "ready", chunkCount: 3 };
}

const mockApi = {
  async uploadDocument(file) {
    await sleep(400);
    const documentId = crypto.randomUUID();
    mockDocs.set(documentId, {
      documentId,
      filename: file.name,
      fileSize: file.size,
      fileType: file.type || "application/octet-stream",
      uploadDate: new Date().toISOString(),
      _createdAt: Date.now(),
    });
    return { documentId, status: "uploaded", filename: file.name };
  },
  async getDocument(documentId) {
    const doc = mockDocs.get(documentId);
    if (!doc) throw new Error("not found");
    return { ...doc, ...mockStatus(doc) };
  },
  async listDocuments() {
    return [...mockDocs.values()].map((d) => ({ ...d, ...mockStatus(d) }));
  },
  async askQuestion(question, documentIds) {
    await sleep(900);
    const scope = documentIds?.length ? "the selected document" : "your documents";
    return {
      answer:
        `(demo answer) Based on ${scope}, here's a grounded response to "${question}". ` +
        `Switch VITE_USE_MOCK to false once API Gateway is wired in Phase 5 to get real Claude answers.`,
      citations: [
        {
          documentId: "demo-doc",
          filename: "CSE3150-syllabus.pdf",
          chunkIndex: 1,
          excerpt:
            "Office hours are held Tuesdays and Thursdays. Final grade is weighted 40% projects, 30% exams, 30% participation…",
        },
        {
          documentId: "demo-doc",
          filename: "CSE3150-syllabus.pdf",
          chunkIndex: 4,
          excerpt:
            "Late submissions lose 10% per day. Academic integrity violations are reported per university policy…",
        },
      ],
    };
  },
};

// ======================================================================
// LIVE backend — real endpoints behind API Gateway (wired in Phase 5).
// ======================================================================
async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

const liveApi = {
  async uploadDocument(file) {
    const fileData = await fileToBase64(file);
    return http("POST", "/documents", {
      filename: file.name,
      fileType: file.type,
      fileData,
    });
  },
  // Note: GET /documents and GET /documents/{id} are small read endpoints
  // we add alongside API Gateway in Phase 5 (a DynamoDB scan + get).
  getDocument: (id) => http("GET", `/documents/${id}`),
  listDocuments: () => http("GET", "/documents"),
  askQuestion: (question, documentIds) =>
    http("POST", "/query", documentIds?.length ? { question, documentIds } : { question }),
};

export const api = USE_MOCK ? mockApi : liveApi;
export const IS_MOCK = USE_MOCK;
