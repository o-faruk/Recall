const BADGE = {
  uploaded: { label: "Queued", cls: "badge--processing" },
  processing: { label: "Processing", cls: "badge--processing" },
  ready: { label: "Ready", cls: "badge--ready" },
  error: { label: "Error", cls: "badge--error" },
};

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentList({ documents, selectedDocId, onSelect }) {
  const totalChunks = documents.reduce((s, d) => s + (d.chunkCount || 0), 0);

  return (
    <div className="doclist-section">
      <div className="sidebar-label sidebar-label--row">
        <span>Documents</span>
        <span className="doclist-count">{documents.length}</span>
      </div>

      {documents.length === 0 ? (
        <div className="doclist-empty">No documents yet.</div>
      ) : (
        <div className="doclist">
          {documents.map((d) => {
            const badge = BADGE[d.status] || BADGE.uploaded;
            const active = d.documentId === selectedDocId;
            return (
              <button
                key={d.documentId}
                className={`docrow${active ? " docrow--active" : ""}`}
                onClick={() => onSelect(d.documentId)}
                title={active ? "Click to clear filter" : "Click to ask within this document"}
              >
                <div className="docrow-top">
                  <span className="docrow-dot" />
                  <span className="docrow-name">{d.filename}</span>
                </div>
                <div className="docrow-bottom">
                  <span className={`badge ${badge.cls}`}>
                    {d.status === "processing" && <span className="badge-spin" />}
                    {badge.label}
                  </span>
                  <span className="docrow-meta">
                    {fmtSize(d.fileSize)}
                    {d.status === "ready" ? ` · ${d.chunkCount} chunks` : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {documents.length > 0 && (
        <div className="doclist-footer">
          {documents.length} docs · {totalChunks} chunks
        </div>
      )}
    </div>
  );
}
