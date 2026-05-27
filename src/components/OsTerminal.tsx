"use client";

import { useMemo } from "react";

type OsTerminalProps = {
  status: string;
  sessionId: string;
  deltaBytes: number;
  fps: number;
  inputBacklog: number;
  inputDropped: number;
  telemetry: string[];
};

export default function OsTerminal({
  status,
  sessionId,
  deltaBytes,
  fps,
  inputBacklog,
  inputDropped,
  telemetry,
}: OsTerminalProps) {
  const telemetryStream = useMemo(() => telemetry.join("\n"), [telemetry]);

  return (
    <aside className="terminal-panel" aria-live="polite">
      <header className="terminal-header">
        <h2>Nomadic Telemetry HUD</h2>
        <p>{status}</p>
      </header>
      <dl className="terminal-metrics">
        <div>
          <dt>Session</dt>
          <dd>{sessionId}</dd>
        </div>
        <div>
          <dt>Delta Bytes</dt>
          <dd>{deltaBytes.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Display FPS</dt>
          <dd>{fps.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Input Backlog</dt>
          <dd>{inputBacklog}</dd>
        </div>
        <div>
          <dt>Dropped Input</dt>
          <dd>{inputDropped}</dd>
        </div>
      </dl>
      <pre className="terminal-stream">
        {telemetryStream.length > 0 ? telemetryStream : "No telemetry packets yet."}
      </pre>
    </aside>
  );
}
