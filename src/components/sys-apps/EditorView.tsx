"use client";

import {
  EDITOR_CURSOR_INDEX,
  EDITOR_FLAGS_INDEX,
  EDITOR_HEADER_INTS,
  EDITOR_SEQUENCE_INDEX,
  EDITOR_TEXT_BYTES_OFFSET,
  EDITOR_TEXT_LEN_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useMemo, useRef, useState } from "react";

type EditorDocument = {
  name: string;
  lines: string[];
};

type EditorSnapshot = {
  sequence: number;
  cursor: number;
  flags: number;
  docs: EditorDocument[];
};

type EditorViewProps = {
  editorBuffer: SharedArrayBuffer;
  onSendKey: (keyCode: number, modifierFlags: number) => void;
};

function toModifierFlags(event: React.KeyboardEvent<HTMLElement>): number {
  let flags = 0;
  if (event.shiftKey) {
    flags |= 1 << 0;
  }
  if (event.altKey) {
    flags |= 1 << 1;
  }
  if (event.ctrlKey) {
    flags |= 1 << 2;
  }
  if (event.metaKey) {
    flags |= 1 << 3;
  }
  return flags;
}

function keyCodeFromEvent(event: React.KeyboardEvent<HTMLElement>): number | null {
  if (event.key.length === 1) {
    return event.key.charCodeAt(0);
  }

  if (event.key === "Enter") {
    return 13;
  }

  if (event.key === "Backspace") {
    return 8;
  }

  if (event.key === "Tab") {
    return 9;
  }

  if (event.key === "ArrowLeft") {
    return 37;
  }

  if (event.key === "ArrowUp") {
    return 38;
  }

  if (event.key === "ArrowRight") {
    return 39;
  }

  if (event.key === "ArrowDown") {
    return 40;
  }

  if (event.key === "Delete") {
    return 46;
  }

  return null;
}

export default function EditorView({ editorBuffer, onSendKey }: EditorViewProps) {
  const decoder = useMemo(() => new TextDecoder(), []);
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({
    sequence: 0,
    cursor: 0,
    flags: 0,
    docs: [],
  });
  const [activeTab, setActiveTab] = useState(0);

  const lastSequenceRef = useRef(0);

  const toDocuments = (text: string): EditorDocument[] => {
    const segments = text.length > 0 ? text.split("\n\n===FILE===\n") : [];
    if (segments.length === 0) {
      return [
        {
          name: "untitled.txt",
          lines: [""],
        },
      ];
    }

    const docs = segments.map((segment, index) => {
      const normalized = segment.replace(/\r/g, "");
      const lines = normalized.split("\n");
      const firstLine = lines[0] ?? "";
      const label = firstLine.startsWith("# ") ? firstLine.slice(2).trim() : `buffer-${index + 1}.txt`;
      return {
        name: label.length > 0 ? label : `buffer-${index + 1}.txt`,
        lines,
      };
    });

    docs.push({
      name: "scratch.log",
      lines: ["live shared-memory editing lane", "typing streams into kernel editor pipe"],
    });
    return docs;
  };

  useEffect(() => {
    const header = new Int32Array(editorBuffer, 0, EDITOR_HEADER_INTS);
    const bytes = new Uint8Array(editorBuffer, EDITOR_TEXT_BYTES_OFFSET);

    const interval = window.setInterval(() => {
      const sequence = Atomics.load(header, EDITOR_SEQUENCE_INDEX);
      if (sequence === lastSequenceRef.current) {
        return;
      }

      lastSequenceRef.current = sequence;
      const cursor = Math.max(0, Atomics.load(header, EDITOR_CURSOR_INDEX));
      const flags = Atomics.load(header, EDITOR_FLAGS_INDEX);
      const textLen = Math.max(0, Math.min(Atomics.load(header, EDITOR_TEXT_LEN_INDEX), bytes.byteLength));
      const text = decoder.decode(bytes.subarray(0, textLen));
      const docs = toDocuments(text);

      setSnapshot({
        sequence,
        cursor,
        flags,
        docs,
      });

      setActiveTab((prev) => (prev >= docs.length ? 0 : prev));
    }, 50);

    return () => {
      window.clearInterval(interval);
    };
  }, [decoder, editorBuffer]);

  const activeDoc = snapshot.docs[activeTab] ?? snapshot.docs[0] ?? { name: "untitled.txt", lines: [""] };

  return (
    <section className="sys-card editor-app" aria-label="Editor app">
      <header>
        <h2>Kernel Editor</h2>
        <p>
          cursor {snapshot.cursor} flags {snapshot.flags} seq {snapshot.sequence}
        </p>
      </header>
      <div className="editor-tabs" role="tablist" aria-label="Editor tabs">
        {snapshot.docs.map((doc, index) => (
          <button
            key={`${doc.name}-${index}`}
            type="button"
            className={`editor-tab ${index === activeTab ? "active" : ""}`}
            onClick={() => setActiveTab(index)}
          >
            {doc.name}
          </button>
        ))}
      </div>
      <div
        className="editor-surface"
        tabIndex={0}
        onKeyDown={(event) => {
          const keyCode = keyCodeFromEvent(event);
          if (keyCode === null) {
            return;
          }

          event.preventDefault();
          onSendKey(keyCode, toModifierFlags(event));
        }}
      >
        <pre>
          {activeDoc.lines.length > 0
            ? activeDoc.lines
                .map((line, index) => `${String(index + 1).padStart(4, " ")}  ${line}`)
                .join("\n")
            : "Editor state is empty."}
        </pre>
      </div>
    </section>
  );
}
