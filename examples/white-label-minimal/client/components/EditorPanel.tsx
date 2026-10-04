"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { MessageSquare, Sparkles, X } from "lucide-react";

// The assistant panel beside the app. On a phone it opens over the page, from
// the Assistant button, and closes with the X or Escape.
export default function EditorPanel({ title, editing, open, onOpen, onClose, children }: {
  title: string;
  editing: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Move keyboard focus into the panel when it opens over the page.
  useEffect(() => {
    if (open && window.matchMedia("(max-width: 760px)").matches) closeButton.current?.focus();
  }, [open]);

  function close() {
    onClose();
    openButton.current?.focus();
  }

  return (
    <>
      <button
        ref={openButton}
        className="mobile-assistant"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls="app-editor"
      >
        <MessageSquare size={18} /> Assistant
      </button>
      <section
        id="app-editor"
        className={`editor-panel ${open ? "is-open" : ""} ${editing ? "is-editing" : ""}`}
        aria-label="App editor"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <header className="editor-heading">
          <div>
            {editing ? (
              <span className="editing-badge">
                <span className="editing-flare" aria-hidden="true" />
                Editing
              </span>
            ) : (
              <Sparkles size={14} />
            )}
            <strong>{title}</strong>
          </div>
          <div>
            <button ref={closeButton} className="icon-button mobile-close" aria-label="Close assistant" onClick={close}>
              <X size={20} />
            </button>
          </div>
        </header>
        {children}
      </section>
    </>
  );
}
