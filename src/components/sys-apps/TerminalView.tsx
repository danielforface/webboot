"use client";

import {
  TERMINAL_COLS_INDEX,
  TERMINAL_CURSOR_X_INDEX,
  TERMINAL_CURSOR_Y_INDEX,
  TERMINAL_HEADER_INTS,
  TERMINAL_ROWS_INDEX,
  TERMINAL_SEQUENCE_INDEX,
  TERMINAL_TEXT_BYTES_OFFSET,
  TERMINAL_TEXT_LEN_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useMemo, useRef, useState } from "react";

type TerminalSnapshot = {
  sequence: number;
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  grid: string[];
};

type TerminalViewProps = {
  terminalBuffer: SharedArrayBuffer;
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

  if (event.key === "Escape") {
    return 27;
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

export default function TerminalView({ terminalBuffer, onSendKey }: TerminalViewProps) {
  const decoder = useMemo(() => new TextDecoder(), []);
  const [snapshot, setSnapshot] = useState<TerminalSnapshot>({
    sequence: 0,
    cols: 80,
    rows: 28,
    cursorX: 0,
    cursorY: 0,
    grid: [],
  });

  const lastSequenceRef = useRef(0);

  const buildGrid = (text: string, cols: number, rows: number, cursorX: number, cursorY: number): string[] => {
    const safeCols = Math.max(1, cols);
    const safeRows = Math.max(1, rows);
    const lines = text.replace(/\r/g, "").split("\n");
    const normalized = lines.map((line) => line.slice(0, safeCols).padEnd(safeCols, " "));
    const tail = normalized.slice(-safeRows);

    while (tail.length < safeRows) {
      tail.unshift(" ".repeat(safeCols));
    }

    const cursorRow = Math.min(safeRows - 1, Math.max(0, cursorY));
    const cursorCol = Math.min(safeCols - 1, Math.max(0, cursorX));
    const rowChars = tail[cursorRow]?.split("") ?? [];
    if (rowChars.length === safeCols) {
      rowChars[cursorCol] = "_";
      tail[cursorRow] = rowChars.join("");
    }

    return tail;
  };

  useEffect(() => {
    const header = new Int32Array(terminalBuffer, 0, TERMINAL_HEADER_INTS);
    const bytes = new Uint8Array(terminalBuffer, TERMINAL_TEXT_BYTES_OFFSET);

    const interval = window.setInterval(() => {
      const sequence = Atomics.load(header, TERMINAL_SEQUENCE_INDEX);
      if (sequence === lastSequenceRef.current) {
        return;
      }

      lastSequenceRef.current = sequence;
      const cols = Math.max(1, Atomics.load(header, TERMINAL_COLS_INDEX));
      const rows = Math.max(1, Atomics.load(header, TERMINAL_ROWS_INDEX));
      const cursorX = Math.max(0, Atomics.load(header, TERMINAL_CURSOR_X_INDEX));
      const cursorY = Math.max(0, Atomics.load(header, TERMINAL_CURSOR_Y_INDEX));
      const textLen = Math.max(0, Math.min(Atomics.load(header, TERMINAL_TEXT_LEN_INDEX), bytes.byteLength));

      const text = decoder.decode(bytes.subarray(0, textLen));
      const grid = buildGrid(text, cols, rows, cursorX, cursorY);
      setSnapshot({
        sequence,
        cols,
        rows,
        cursorX,
        cursorY,
        grid,
      });
    }, 50);

    return () => {
      window.clearInterval(interval);
    };
  }, [decoder, terminalBuffer]);

  return (
    <section className="sys-card terminal-app" aria-label="Terminal app">
      <header>
        <h2>System Terminal</h2>
        <p>
          {snapshot.cols}x{snapshot.rows} cursor {snapshot.cursorX}:{snapshot.cursorY} seq {snapshot.sequence}
        </p>
      </header>
      <div
        className="terminal-matrix"
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
        <pre>{snapshot.grid.length > 0 ? snapshot.grid.join("\n") : "Terminal waiting for kernel output..."}</pre>
      </div>
    </section>
  );
}
