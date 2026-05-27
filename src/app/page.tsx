"use client";

import OsTerminal from "@/components/OsTerminal";
import SpatialDisplay from "@/components/SpatialDisplay";
import {
  DEFAULT_VIRTUAL_HEIGHT,
  DEFAULT_VIRTUAL_WIDTH,
  createInputRingBuffer,
  createRenderTreeBuffer,
} from "@/lib/spatialShared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WorkerToUi =
  | {
      type: "OS_READY";
      memoryBytes: number;
      sessionId: string;
    }
  | {
      type: "DELTA_PUSHED";
      bytes: number;
      pages: number;
    }
  | {
      type: "OS_SUSPENDED";
    }
  | {
      type: "OS_RESUMED";
    }
  | {
      type: "TELEMETRY";
      message: string;
    }
  | {
      type: "OS_FAULT";
      message: string;
    };

function getOrCreateSessionId(): string {
  const key = "everywhere-os-session";
  const existing = window.localStorage.getItem(key);
  if (existing && existing.length > 0) {
    return existing;
  }

  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `nomad-${Date.now().toString(36)}`;
  window.localStorage.setItem(key, next);
  return next;
}

export default function HomePage() {
  const workerRef = useRef<Worker | null>(null);

  const inputRingBuffer = useMemo(() => createInputRingBuffer(), []);
  const renderTreeBuffer = useMemo(
    () => createRenderTreeBuffer(DEFAULT_VIRTUAL_WIDTH, DEFAULT_VIRTUAL_HEIGHT),
    [],
  );

  const [statusText, setStatusText] = useState("Kernel idle");
  const [sessionId, setSessionId] = useState("session-pending");
  const [deltaBytes, setDeltaBytes] = useState(0);
  const [fps, setFps] = useState(0);
  const [inputBacklog, setInputBacklog] = useState(0);
  const [inputDropped, setInputDropped] = useState(0);
  const [telemetry, setTelemetry] = useState<string[]>([]);

  const handleDisplayMetrics = useCallback((metrics: { fps: number; backlog: number; dropped: number }) => {
    setFps(metrics.fps);
    setInputBacklog(metrics.backlog);
    setInputDropped(metrics.dropped);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/core-worker.ts", import.meta.url), {
      type: "module",
      name: "core-worker",
    });
    workerRef.current = worker;

    const persistedSessionId = getOrCreateSessionId();
    setSessionId(persistedSessionId);

    worker.onmessage = (event: MessageEvent<WorkerToUi>) => {
      const message = event.data;

      if (message.type === "OS_READY") {
        const mib = Math.floor(message.memoryBytes / (1024 * 1024));
        setStatusText(`Kernel ready (${mib} MiB mapped)`);
        setSessionId(message.sessionId);
        return;
      }

      if (message.type === "DELTA_PUSHED") {
        setDeltaBytes((prev) => prev + message.bytes);
        setTelemetry((prev) =>
          [`[SYNC] pushed ${message.pages} pages (${message.bytes} bytes)`, ...prev].slice(0, 80),
        );
        return;
      }

      if (message.type === "OS_SUSPENDED") {
        setStatusText("Kernel suspended");
        return;
      }

      if (message.type === "OS_RESUMED") {
        setStatusText("Kernel resumed");
        return;
      }

      if (message.type === "TELEMETRY") {
        setTelemetry((prev) => [message.message, ...prev].slice(0, 120));
        return;
      }

      setStatusText(`Fault: ${message.message}`);
      setTelemetry((prev) => [`[FAULT] ${message.message}`, ...prev].slice(0, 120));
    };

    worker.postMessage({
      type: "INIT_OS",
      payload: {
        sessionId: persistedSessionId,
        wasmUrl: "/wasm/core-os.wasm",
        initialPages: 4096,
        maximumPages: 32768,
        flags: 0,
        inputRingBuffer,
        renderTreeBuffer,
        virtualWidth: DEFAULT_VIRTUAL_WIDTH,
        virtualHeight: DEFAULT_VIRTUAL_HEIGHT,
      },
    });

    return () => {
      worker.postMessage({ type: "SUSPEND_OS" });
      worker.postMessage({ type: "SHUTDOWN" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [inputRingBuffer, renderTreeBuffer]);

  return (
    <main className="shell">
      <header className="shell-header">
        <p className="eyebrow">The Everywhere Nomadic OS</p>
        <h1>Spatial Runtime Control Surface</h1>
        <p className="summary">
          The Next.js layer is only a viewport and sync dashboard. Core session logic,
          dirty-page tracking, and window composition all execute inside a WASM kernel
          hosted by dedicated workers.
        </p>
      </header>

      <section className="workspace-grid">
        <SpatialDisplay
          inputRingBuffer={inputRingBuffer}
          renderTreeBuffer={renderTreeBuffer}
          virtualWidth={DEFAULT_VIRTUAL_WIDTH}
          virtualHeight={DEFAULT_VIRTUAL_HEIGHT}
          onMetrics={handleDisplayMetrics}
        />
        <OsTerminal
          status={statusText}
          sessionId={sessionId}
          deltaBytes={deltaBytes}
          fps={fps}
          inputBacklog={inputBacklog}
          inputDropped={inputDropped}
          telemetry={telemetry}
        />
      </section>
    </main>
  );
}
