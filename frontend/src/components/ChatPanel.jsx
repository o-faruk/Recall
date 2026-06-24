import { useEffect, useRef, useState } from "react";
import CitationCard from "./CitationCard.jsx";

export default function ChatPanel({ messages, sending, scopeLabel, onSend }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const submit = () => {
    const q = input.trim();
    if (!q || sending) return;
    onSend(q);
    setInput("");
  };

  const empty = messages.length === 0;

  return (
    <div className="chat">
      <div className="chat-header">
        <span className="chat-scope-dot" />
        {scopeLabel}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {empty && !sending ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">⌕</div>
            <div className="chat-empty-title">Ask a question about your documents</div>
            <div className="chat-empty-sub">
              Upload a PDF or text file, wait for it to turn <span className="badge badge--ready">Ready</span>, then ask away.
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg msg--user">{m.text}</div>
              ) : (
                <div key={i} className="msg-block">
                  <div className="msg msg--ai">{m.text}</div>
                  {m.citations?.length > 0 && (
                    <>
                      <div className="citations-label">Citations</div>
                      <div className="citations">
                        {m.citations.map((c, j) => (
                          <CitationCard key={j} citation={c} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            )}
            {sending && (
              <div className="msg msg--ai msg--typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-box">
          <input
            className="composer-input"
            placeholder="Ask a question about your documents…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button
            className="composer-send"
            disabled={!input.trim() || sending}
            onClick={submit}
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
