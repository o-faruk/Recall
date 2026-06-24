import { useEffect, useState, useCallback } from "react";
import { api, IS_MOCK } from "./api.js";
import UploadPanel from "./components/UploadPanel.jsx";
import DocumentList from "./components/DocumentList.jsx";
import ChatPanel from "./components/ChatPanel.jsx";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Load any existing documents on mount.
  useEffect(() => {
    api.listDocuments().then(setDocuments).catch(() => {});
  }, []);

  // Poll any document that isn't finished yet, until it's ready/error.
  useEffect(() => {
    const pending = documents.filter((d) => d.status === "uploaded" || d.status === "processing");
    if (!pending.length) return;
    const t = setInterval(async () => {
      const updated = await Promise.all(
        pending.map((d) => api.getDocument(d.documentId).catch(() => d))
      );
      setDocuments((prev) =>
        prev.map((d) => updated.find((u) => u.documentId === d.documentId) || d)
      );
    }, 1500);
    return () => clearInterval(t);
  }, [documents]);

  const handleUpload = useCallback(async (file) => {
    setError(null);
    try {
      const { documentId } = await api.uploadDocument(file);
      const doc = await api.getDocument(documentId);
      setDocuments((prev) => [doc, ...prev.filter((d) => d.documentId !== documentId)]);
    } catch (e) {
      setError(`Upload failed: ${e.message}`);
    }
  }, []);

  const handleSend = useCallback(
    async (question) => {
      setMessages((m) => [...m, { role: "user", text: question }]);
      setSending(true);
      setError(null);
      try {
        const ids = selectedDocId ? [selectedDocId] : undefined;
        const { answer, citations } = await api.askQuestion(question, ids);
        setMessages((m) => [...m, { role: "assistant", text: answer, citations }]);
      } catch (e) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Sorry — something went wrong: ${e.message}`, citations: [] },
        ]);
      } finally {
        setSending(false);
      }
    },
    [selectedDocId]
  );

  const selectedDoc = documents.find((d) => d.documentId === selectedDocId) || null;
  const scopeLabel = selectedDoc ? `Asking within ${selectedDoc.filename}` : "Asking across all documents";

  return (
    <div className="app">
      <header className="navbar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span className="brand-name">Recall</span>
          <span className="brand-tag">RAG document search</span>
        </div>
        <div className="navbar-right">
          {IS_MOCK && <span className="mock-pill">demo mode</span>}
          <a className="gh-link" href="https://github.com/" target="_blank" rel="noreferrer">
            Omar Faruk
          </a>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <UploadPanel onUpload={handleUpload} />
          <DocumentList
            documents={documents}
            selectedDocId={selectedDocId}
            onSelect={(id) => setSelectedDocId((cur) => (cur === id ? null : id))}
          />
        </aside>

        <main className="main">
          {error && <div className="banner-error">{error}</div>}
          <ChatPanel messages={messages} sending={sending} scopeLabel={scopeLabel} onSend={handleSend} />
        </main>
      </div>
    </div>
  );
}
