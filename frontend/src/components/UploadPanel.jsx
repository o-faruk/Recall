import { useRef, useState } from "react";

const ACCEPT = ".pdf,.txt,application/pdf,text/plain";

export default function UploadPanel({ onUpload }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files) => {
    for (const file of files) onUpload(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="upload-section">
      <div className="sidebar-label">Upload</div>
      <div
        className={`dropzone${dragging ? " dropzone--active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      >
        <div className="dropzone-icon">↑</div>
        <div className="dropzone-title">Drag &amp; drop a document</div>
        <div className="dropzone-sub">or click to browse</div>
        <div className="dropzone-types">PDF · TXT</div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
