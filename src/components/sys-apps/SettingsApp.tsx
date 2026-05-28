"use client";

import {
  HAL_AUDIO_SEQUENCE_INDEX,
  HAL_CAMERA_SEQUENCE_INDEX,
  HAL_GAMEPAD_SEQUENCE_INDEX,
  HAL_HAPTICS_SEQUENCE_INDEX,
  HAL_LOCATION_SEQUENCE_INDEX,
  HAL_NFC_SEQUENCE_INDEX,
  HAL_PERIPHERAL_SEQUENCE_INDEX,
  HAL_SENSOR_SEQUENCE_INDEX,
  HAL_SERIAL_SEQUENCE_INDEX,
  HAL_XR_SEQUENCE_INDEX,
  HARDWARE_HAL_HEADER_INTS,
} from "@/lib/spatialShared";
import { useEffect, useMemo, useState } from "react";

type SettingsMetrics = {
  tick: bigint;
  totalPages: number;
  dirtyPages: number;
  activeApps: number;
  pendingInput: number;
  compactionSequence: number;
  compactedPages: number;
  syncStatus: number;
};

type SettingsAppProps = {
  metrics: SettingsMetrics;
  hardwareHalBuffer: SharedArrayBuffer;
  onCheckpoint: () => void;
  onClearReplay: () => void;
  onFlushOpfs: () => Promise<void>;
};

type HalSnapshot = {
  sensorSeq: number;
  locationSeq: number;
  audioSeq: number;
  cameraSeq: number;
  peripheralSeq: number;
  nfcSeq: number;
  gamepadSeq: number;
  serialSeq: number;
  xrSeq: number;
  hapticsSeq: number;
};

function syncStatusText(syncStatus: number): string {
  if (syncStatus < 0) {
    return "fault";
  }

  if (syncStatus === 1) {
    return "syncing";
  }

  if (syncStatus === 2) {
    return "steady";
  }

  return "idle";
}

function percent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function clampBar(value: number): number {
  return Math.max(4, Math.min(100, value));
}

export default function SettingsApp({
  metrics,
  hardwareHalBuffer,
  onCheckpoint,
  onClearReplay,
  onFlushOpfs,
}: SettingsAppProps) {
  const [hal, setHal] = useState<HalSnapshot>({
    sensorSeq: 0,
    locationSeq: 0,
    audioSeq: 0,
    cameraSeq: 0,
    peripheralSeq: 0,
    nfcSeq: 0,
    gamepadSeq: 0,
    serialSeq: 0,
    xrSeq: 0,
    hapticsSeq: 0,
  });
  const [flushState, setFlushState] = useState<"idle" | "flushing" | "done" | "error">("idle");

  useEffect(() => {
    const header = new Int32Array(hardwareHalBuffer, 0, HARDWARE_HAL_HEADER_INTS);
    const interval = window.setInterval(() => {
      setHal({
        sensorSeq: Atomics.load(header, HAL_SENSOR_SEQUENCE_INDEX),
        locationSeq: Atomics.load(header, HAL_LOCATION_SEQUENCE_INDEX),
        audioSeq: Atomics.load(header, HAL_AUDIO_SEQUENCE_INDEX),
        cameraSeq: Atomics.load(header, HAL_CAMERA_SEQUENCE_INDEX),
        peripheralSeq: Atomics.load(header, HAL_PERIPHERAL_SEQUENCE_INDEX),
        nfcSeq: Atomics.load(header, HAL_NFC_SEQUENCE_INDEX),
        gamepadSeq: Atomics.load(header, HAL_GAMEPAD_SEQUENCE_INDEX),
        serialSeq: Atomics.load(header, HAL_SERIAL_SEQUENCE_INDEX),
        xrSeq: Atomics.load(header, HAL_XR_SEQUENCE_INDEX),
        hapticsSeq: Atomics.load(header, HAL_HAPTICS_SEQUENCE_INDEX),
      });
    }, 120);

    return () => {
      window.clearInterval(interval);
    };
  }, [hardwareHalBuffer]);

  const dirtyRatio = useMemo(
    () => percent(metrics.dirtyPages, metrics.totalPages),
    [metrics.dirtyPages, metrics.totalPages],
  );
  const queueRatio = useMemo(
    () => percent(metrics.pendingInput, Math.max(1, metrics.activeApps * 32)),
    [metrics.pendingInput, metrics.activeApps],
  );
  const halTotal =
    hal.sensorSeq
    + hal.locationSeq
    + hal.audioSeq
    + hal.cameraSeq
    + hal.peripheralSeq
    + hal.nfcSeq
    + hal.gamepadSeq
    + hal.serialSeq
    + hal.xrSeq
    + hal.hapticsSeq;

  return (
    <section className="sys-card settings-app" aria-label="Settings app">
      <header>
        <h2>System Settings & Diagnostics</h2>
        <p>Live memory, synchronization, and HAL telemetry surfaces.</p>
      </header>
      <dl>
        <div>
          <dt>Scheduler Tick</dt>
          <dd>{metrics.tick.toString()}</dd>
        </div>
        <div>
          <dt>Memory Pages</dt>
          <dd>
            {metrics.dirtyPages}/{metrics.totalPages}
          </dd>
        </div>
        <div>
          <dt>Active Apps</dt>
          <dd>{metrics.activeApps}</dd>
        </div>
        <div>
          <dt>Pending Input</dt>
          <dd>{metrics.pendingInput}</dd>
        </div>
        <div>
          <dt>Compaction</dt>
          <dd>
            seq {metrics.compactionSequence} / pages {metrics.compactedPages}
          </dd>
        </div>
        <div>
          <dt>Snapshot Link</dt>
          <dd>{syncStatusText(metrics.syncStatus)}</dd>
        </div>
        <div>
          <dt>HAL Events</dt>
          <dd>{halTotal}</dd>
        </div>
        <div>
          <dt>Sensors/GPS</dt>
          <dd>
            {hal.sensorSeq}/{hal.locationSeq}
          </dd>
        </div>
        <div>
          <dt>Audio/Camera</dt>
          <dd>
            {hal.audioSeq}/{hal.cameraSeq}
          </dd>
        </div>
        <div>
          <dt>Peripheral I/O</dt>
          <dd>
            usb {hal.peripheralSeq} nfc {hal.nfcSeq} gp {hal.gamepadSeq} serial {hal.serialSeq}
          </dd>
        </div>
      </dl>
      <div className="settings-charts">
        <div className="settings-bar">
          <span>Dirty Pages</span>
          <b>{dirtyRatio.toFixed(1)}%</b>
          <i style={{ width: `${clampBar(dirtyRatio)}%` }} />
        </div>
        <div className="settings-bar">
          <span>Input Queue</span>
          <b>{queueRatio.toFixed(1)}%</b>
          <i style={{ width: `${clampBar(queueRatio)}%` }} />
        </div>
      </div>
      <div className="settings-log" aria-label="transaction logs">
        <p>tx-log: compaction seq {metrics.compactionSequence} pages {metrics.compactedPages}</p>
        <p>sync-log: checkpoint channel {syncStatusText(metrics.syncStatus)}</p>
        <p>hal-log: xr {hal.xrSeq} haptics {hal.hapticsSeq}</p>
      </div>
      <div className="settings-actions">
        <button type="button" onClick={onCheckpoint}>
          Force checkpoint
        </button>
        <button type="button" onClick={onClearReplay}>
          Purge replay log
        </button>
        <button
          type="button"
          onClick={() => {
            setFlushState("flushing");
            onFlushOpfs()
              .then(() => setFlushState("done"))
              .catch(() => setFlushState("error"));
          }}
        >
          Flush OPFS Cache
        </button>
        <button type="button" disabled>
          {flushState === "idle" ? "Cache: idle" : flushState}
        </button>
      </div>
    </section>
  );
}
