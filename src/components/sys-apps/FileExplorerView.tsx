"use client";

import {
  APP_KIND_AUDIO_PLAYER,
  APP_KIND_FILE_EXPLORER,
  APP_KIND_PHOTO_VIEWER,
  FILES_ENTRY_COUNT_INDEX,
  FILES_HEADER_INTS,
  FILES_SEQUENCE_INDEX,
  FILES_TEXT_BYTES_OFFSET,
  FILES_TEXT_LEN_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useMemo, useRef, useState } from "react";

type FileExplorerViewProps = {
  fileExplorerBuffer: SharedArrayBuffer;
  onLaunch: (kind: number) => void;
  onLaunchApk: (vfsPath: string) => void;
};

type ExplorerState = {
  sequence: number;
  entries: number;
  lines: Array<{
    raw: string;
    path: string;
    isApk: boolean;
    isDir: boolean;
    syncState: "dirty" | "synced" | "queued";
    depth: number;
  }>;
};

function parseLine(raw: string): {
  raw: string;
  path: string;
  isApk: boolean;
  isDir: boolean;
  syncState: "dirty" | "synced" | "queued";
  depth: number;
} {
  const marker = " /";
  const markerIndex = raw.indexOf(marker);
  const path = markerIndex >= 0 ? raw.slice(markerIndex + 1).trim() : raw.trim();
  const isApk = path.toLowerCase().endsWith(".apk");
  const isDir = raw.includes(" dir ");

  let syncState: "dirty" | "synced" | "queued" = "queued";
  if (raw.startsWith("[dirty]")) {
    syncState = "dirty";
  } else if (raw.startsWith("[synced]")) {
    syncState = "synced";
  }

  const depth = Math.max(0, path.split("/").filter(Boolean).length - 1);
  return { raw, path, isApk, isDir, syncState, depth };
}

function lineClass(line: string): string {
  if (line.startsWith("[dirty]")) {
    return "dirty";
  }

  if (line.startsWith("[synced]")) {
    return "synced";
  }

  return "queued";
}

export default function FileExplorerView({
  fileExplorerBuffer,
  onLaunch,
  onLaunchApk,
}: FileExplorerViewProps) {
  const decoder = useMemo(() => new TextDecoder(), []);
  const [state, setState] = useState<ExplorerState>({
    sequence: 0,
    entries: 0,
    lines: [],
  });
  const lastSequenceRef = useRef(0);

  useEffect(() => {
    const header = new Int32Array(fileExplorerBuffer, 0, FILES_HEADER_INTS);
    const bytes = new Uint8Array(fileExplorerBuffer, FILES_TEXT_BYTES_OFFSET);

    const interval = window.setInterval(() => {
      const sequence = Atomics.load(header, FILES_SEQUENCE_INDEX);
      if (sequence === lastSequenceRef.current) {
        return;
      }

      lastSequenceRef.current = sequence;
      const entries = Math.max(0, Atomics.load(header, FILES_ENTRY_COUNT_INDEX));
      const textLen = Math.max(0, Math.min(Atomics.load(header, FILES_TEXT_LEN_INDEX), bytes.byteLength));
      const text = decoder.decode(bytes.subarray(0, textLen));
      const lines = text.length > 0 ? text.split("\n").map(parseLine) : [];

      setState({
        sequence,
        entries,
        lines,
      });
    }, 70);

    return () => {
      window.clearInterval(interval);
    };
  }, [decoder, fileExplorerBuffer]);

  const launchEntry = (path: string, isApk: boolean): void => {
    const lower = path.toLowerCase();
    if (isApk) {
      onLaunchApk(path);
      return;
    }

    if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
      onLaunch(APP_KIND_PHOTO_VIEWER);
      return;
    }

    if (lower.endsWith(".mp3") || lower.endsWith(".wav") || lower.endsWith(".ogg") || lower.endsWith(".flac")) {
      onLaunch(APP_KIND_AUDIO_PLAYER);
      return;
    }

    onLaunch(APP_KIND_FILE_EXPLORER);
  };

  return (
    <section className="sys-card files-app" aria-label="File explorer app">
      <header>
        <h2>VFS Explorer</h2>
        <p>
          entries {state.entries} seq {state.sequence}
        </p>
      </header>
      <div className="files-list">
        {state.lines.length === 0 ? (
          <p className="empty">No synchronized paths available.</p>
        ) : (
          state.lines.map((line, index) => {
            return (
              <div
                key={`${state.sequence}-${index}`}
                className={`files-row ${lineClass(line.raw)}`}
                onDoubleClick={() => launchEntry(line.path, line.isApk)}
                title={line.path}
              >
                <span style={{ paddingLeft: `${line.depth * 0.65}rem` }}>
                  {line.isDir ? "[DIR]" : "[FILE]"} {line.path}
                </span>
                {line.isApk ? (
                  <button
                    type="button"
                    className="files-apk-launch"
                    onClick={() => onLaunchApk(line.path)}
                  >
                    Launch APK
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <div className="files-actions">
        <button type="button" onClick={() => onLaunch(APP_KIND_FILE_EXPLORER)}>
          Launch Explorer Runtime
        </button>
      </div>
    </section>
  );
}
