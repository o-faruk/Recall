import { useState } from "react";

export default function CitationCard({ citation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`citation${open ? " citation--open" : ""}`} onClick={() => setOpen((o) => !o)}>
      <div className="citation-head">
        <span className="citation-file">
          <span className="citation-doticon" />
          {citation.filename}
        </span>
        <span className="citation-ref">chunk {citation.chunkIndex}</span>
        <span className="citation-chev">{open ? "▴" : "▾"}</span>
      </div>
      <div className="citation-excerpt">{citation.excerpt}</div>
    </div>
  );
}
