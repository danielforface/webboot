"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WorkerBooted = {
  type: "booted";
  memoryBytes: number;
  ringOffset: number;
  ringLength: number;
};

type WorkerTelemetry = {
  type: "telemetry";
  eventCode: number;
  arg0: number;
  arg1: number;
  timestampNs: bigint;
};

type WorkerFault = {
  type: "fault";
  message: string;
};

type WorkerToUi = WorkerBooted | WorkerTelemetry | WorkerFault;

export default function OsViewport() {
  const workerRef = useRef<Worker | null>(null);
  const [statusText, setStatusText] = useState("Bootloader not started");
  const [ringInfo, setRingInfo] = useState("ring: not allocated");
  const [telemetry, setTelemetry] = useState<string[]>([]);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/os-worker.ts", import.meta.url), {
      type: "module",
      name: "os-worker",
    });

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerToUi>) => {
      const msg = event.data;

      if (msg.type === "booted") {
        setStatusText(`Booted with ${Math.floor(msg.memoryBytes / (1024 * 1024))} MiB shared memory`);
        setRingInfo(`ring @ ${msg.ringOffset} bytes, size ${msg.ringLength} bytes`);
        return;
      }

      if (msg.type === "telemetry") {
        const line = `${msg.timestampNs.toString()} | evt=${msg.eventCode} | a0=${msg.arg0} | a1=${msg.arg1}`;
        setTelemetry((prev) => [line, ...prev].slice(0, 60));
        return;
      }

      if (msg.type === "fault") {
        setStatusText(`Fault: ${msg.message}`);
      }
    };

    worker.postMessage({
      type: "boot",
      wasmUrl: "/wasm/os-kernel.wasm",
      initialPages: 2048,
      maximumPages: 8192,
      ringPages: 16,
    });

    const pollId = window.setInterval(() => {
      worker.postMessage({
        type: "poll",
        deadlineNs: BigInt(
          Math.floor((performance.timeOrigin + performance.now() + 2) * 1_000_000),
        ),
      });
    }, 8);

    return () => {
      window.clearInterval(pollId);
      worker.postMessage({ type: "shutdown" });
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const telemetryView = useMemo(() => telemetry.join("\n"), [telemetry]);

  return (
    <section className="viewport-shell">
      <div className="viewport-status">
        <strong>{statusText}</strong>
        <span>{ringInfo}</span>
      </div>
      <canvas className="viewport-canvas" width={1280} height={720} />
      <pre className="telemetry-stream" aria-live="polite">
        {telemetryView.length > 0 ? telemetryView : "No kernel telemetry yet."}
      </pre>
    </section>
  );
}
