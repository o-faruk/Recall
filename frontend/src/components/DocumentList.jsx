import { useState } from "react";

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

export default function DocumentList({ documents, selectedDocId, onSelect, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(null);
  const totalChunks = documents.reduce((s, d) => s + (d.chunkCount || 0), 0);

  const handleDelete = (e, docId) => {
    e.stopPropagation();
    if (confirm("Delete this document and all its data?")) {
      onDelete(docId);
      setMenuOpen(null);
    }
  };

  const handleRetry = (e, docId) => {
    e.stopPropagation();
    onDelete(docId); // remove failed doc, user can re-upload
    setMenuOpen(null);
  };

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
            const isFailed = d.status === "error";
            return (
              <div
                key={d.documentId}
                className="docrow-wrapper"
                style={{ position: "relative" }}
              >
                <button
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

                {/* Menu button for delete/retry */}
                <div className="docrow-menu">
                  <button
                    className="docrow-menu-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(menuOpen === d.documentId ? null : d.documentId);
                    }}
                    title="Options"
                  >
                    ⋯
                  </button>
                  {menuOpen === d.documentId && (
                    <div className="docrow-menu-popup">
                      {isFailed && (
                        <button
                          className="docrow-menu-item"
                          onClick={(e) => handleRetry(e, d.documentId)}
                        >
                          Retry Upload
                        </button>
                      )}
                      <button
                        className="docrow-menu-item docrow-menu-item--delete"
                        onClick={(e) => handleDelete(e, d.documentId)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
