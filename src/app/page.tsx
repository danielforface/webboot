"use client";

import AppBar from "@/components/sys-apps/AppBar";
import AppLauncher from "@/components/sys-apps/AppLauncher";
import APKInstaller from "@/components/sys-apps/APKInstaller";
import AudioPlayerView from "@/components/sys-apps/AudioPlayerView";
import EditorView from "@/components/sys-apps/EditorView";
import FileExplorerView from "@/components/sys-apps/FileExplorerView";
import PhotoViewer from "@/components/sys-apps/PhotoViewer";
import ScreenCapApp from "@/components/sys-apps/ScreenCapApp";
import SettingsApp from "@/components/sys-apps/SettingsApp";
import TerminalView from "@/components/sys-apps/TerminalView";
import VoiceRecApp from "@/components/sys-apps/VoiceRecApp";
import OsTerminal from "@/components/OsTerminal";
import SpatialDisplay from "@/components/SpatialDisplay";
import {
  DEFAULT_VIRTUAL_HEIGHT,
  DEFAULT_VIRTUAL_WIDTH,
  INPUT_EVENT_EDITOR_KEY,
  INPUT_EVENT_LOAD_APP,
  INPUT_EVENT_TERMINAL_KEY,
  METRICS_HEADER_INTS,
  METRICS_SYNC_STATUS_INDEX,
  createEditorBuffer,
  createFileExplorerBuffer,
  createHardwareHalBuffer,
  createInputRingViews,
  createInputRingBuffer,
  createMediaBuffer,
  createRenderTreeBuffer,
  createSystemMetricsBuffer,
  createTerminalBuffer,
  pushInputPacket,
} from "@/lib/spatialShared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RuntimeAppDescriptor = {
  appId: number;
  windowId: number;
  kind: number;
  status: number;
  arenaOffset: number;
  arenaLen: number;
};

type UiToWorker =
  | {
      type: "SUSPEND_OS";
    }
  | {
      type: "RESUME_OS";
      sessionId?: string;
    }
  | {
      type: "REQUEST_CHECKPOINT";
    }
  | {
      type: "LOAD_COMPONENT";
      kind: number;
      path?: string;
    }
  | {
      type: "INSTALL_APK";
      vfsPath: string;
    }
  | {
      type: "START_ANDROID_ACTIVITY";
      action: string;
      categories: string[];
      dataUri: string;
      packageName: string;
      className: string;
    }
  | {
      type: "CLEAR_SESSION_CACHE";
      sessionId?: string;
    }
  | {
      type: "SHUTDOWN";
    };

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
      sequence: number;
      kind: string;
    }
  | {
      type: "SYSTEM_METRICS";
      tick: bigint;
      totalPages: number;
      dirtyPages: number;
      activeApps: number;
      pendingInput: number;
      compactionSequence: number;
      compactedPages: number;
    }
  | {
      type: "APP_LIST";
      apps: RuntimeAppDescriptor[];
    }
  | {
      type: "APP_LOADED";
      appId: number;
      kind: number;
    }
  | {
      type: "APK_DEPLOYED";
      packageName: string;
      mountPath: string;
      installedCount: number;
    }
  | {
      type: "ANDROID_ACTIVITY_STARTED";
      appId: number;
      packageName: string;
      className: string;
    }
  | {
      type: "OS_SUSPENDED";
    }
  | {
      type: "OS_RESUMED";
      sessionId: string;
    }
  | {
      type: "TELEMETRY";
      message: string;
    }
  | {
      type: "OS_FAULT";
      message: string;
    };

type SystemMetrics = {
  tick: bigint;
  totalPages: number;
  dirtyPages: number;
  activeApps: number;
  pendingInput: number;
  compactionSequence: number;
  compactedPages: number;
  syncStatus: number;
};

function packageNameFromVfsPath(vfsPath: string): string {
  const lower = vfsPath.trim().toLowerCase();
  if (lower.endsWith("/base.apk")) {
    const parts = lower.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return parts[parts.length - 2] ?? "android-app";
    }
  }

  const tail = lower.split("/").pop() ?? "android-app.apk";
  return tail.replace(/\.apk$/i, "") || "android-app";
}

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
  const inputRingViews = useMemo(() => createInputRingViews(inputRingBuffer), [inputRingBuffer]);
  const renderTreeBuffer = useMemo(
    () => createRenderTreeBuffer(DEFAULT_VIRTUAL_WIDTH, DEFAULT_VIRTUAL_HEIGHT),
    [],
  );
  const metricsBuffer = useMemo(() => createSystemMetricsBuffer(), []);
  const terminalBuffer = useMemo(() => createTerminalBuffer(), []);
  const editorBuffer = useMemo(() => createEditorBuffer(), []);
  const mediaBuffer = useMemo(() => createMediaBuffer(), []);
  const fileExplorerBuffer = useMemo(() => createFileExplorerBuffer(), []);
  const hardwareHalBuffer = useMemo(() => createHardwareHalBuffer(), []);

  const [statusText, setStatusText] = useState("Kernel idle");
  const [sessionId, setSessionId] = useState("session-pending");
  const [deltaBytes, setDeltaBytes] = useState(0);
  const [fps, setFps] = useState(0);
  const [inputBacklog, setInputBacklog] = useState(0);
  const [inputDropped, setInputDropped] = useState(0);
  const [telemetry, setTelemetry] = useState<string[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [displayFullscreen, setDisplayFullscreen] = useState(false);
  const [apps, setApps] = useState<RuntimeAppDescriptor[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    tick: 0n,
    totalPages: 0,
    dirtyPages: 0,
    activeApps: 0,
    pendingInput: 0,
    compactionSequence: 0,
    compactedPages: 0,
    syncStatus: 0,
  });

  const postWorker = useCallback((message: UiToWorker) => {
    workerRef.current?.postMessage(message);
  }, []);

  const pushRingEvent = useCallback(
    (eventType: number, paramA: number, paramB: number, modifierFlags: number): boolean => {
      return pushInputPacket(inputRingViews, {
        eventType,
        paramA,
        paramB,
        modifierFlags,
      });
    },
    [inputRingViews],
  );

  const launchApp = useCallback(
    (kind: number) => {
      const queued = pushRingEvent(INPUT_EVENT_LOAD_APP, kind, 0, 0);
      if (!queued) {
        postWorker({ type: "LOAD_COMPONENT", kind });
      }
    },
    [postWorker, pushRingEvent],
  );

  const installApk = useCallback(
    (_packageName: string, vfsPath: string) => {
      postWorker({ type: "INSTALL_APK", vfsPath });
    },
    [postWorker],
  );

  const launchApk = useCallback(
    (vfsPath: string) => {
      const packageName = packageNameFromVfsPath(vfsPath);
      postWorker({
        type: "START_ANDROID_ACTIVITY",
        action: "android.intent.action.VIEW",
        categories: ["android.intent.category.DEFAULT"],
        dataUri: `content://apk/${packageName}`,
        packageName,
        className: "MainActivity",
      });
    },
    [postWorker],
  );

  const sendTerminalKey = useCallback(
    (keyCode: number, modifierFlags: number) => {
      pushRingEvent(INPUT_EVENT_TERMINAL_KEY, keyCode, 0, modifierFlags);
    },
    [pushRingEvent],
  );

  const sendEditorKey = useCallback(
    (keyCode: number, modifierFlags: number) => {
      pushRingEvent(INPUT_EVENT_EDITOR_KEY, keyCode, 0, modifierFlags);
    },
    [pushRingEvent],
  );

  const flushOpfs = useCallback(async () => {
    if ("storage" in navigator && "persist" in navigator.storage) {
      await navigator.storage.persist();
    }
    postWorker({ type: "REQUEST_CHECKPOINT" });
    setTelemetry((prev) => ["[SYNC] OPFS flush requested via checkpoint", ...prev].slice(0, 120));
  }, [postWorker]);

  const handleDisplayMetrics = useCallback((metrics: { fps: number; backlog: number; dropped: number }) => {
    setFps(metrics.fps);
    setInputBacklog(metrics.backlog);
    setInputDropped(metrics.dropped);
  }, []);

  useEffect(() => {
    const header = new Int32Array(metricsBuffer, 0, METRICS_HEADER_INTS);
    const interval = window.setInterval(() => {
      const syncStatus = Atomics.load(header, METRICS_SYNC_STATUS_INDEX);
      setSystemMetrics((prev) => ({
        ...prev,
        syncStatus,
      }));
    }, 160);

    return () => {
      window.clearInterval(interval);
    };
  }, [metricsBuffer]);

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
          [
            `[SYNC] kind=${message.kind} seq=${message.sequence} pushed ${message.pages} pages (${message.bytes} bytes)`,
            ...prev,
          ].slice(0, 100),
        );
        return;
      }

      if (message.type === "SYSTEM_METRICS") {
        setSystemMetrics((prev) => ({
          ...prev,
          tick: message.tick,
          totalPages: message.totalPages,
          dirtyPages: message.dirtyPages,
          activeApps: message.activeApps,
          pendingInput: message.pendingInput,
          compactionSequence: message.compactionSequence,
          compactedPages: message.compactedPages,
        }));
        return;
      }

      if (message.type === "APP_LIST") {
        setApps(message.apps);
        return;
      }

      if (message.type === "APP_LOADED") {
        setTelemetry((prev) =>
          [`[APPS] loaded kind=${message.kind} appId=${message.appId}`, ...prev].slice(0, 100),
        );
        return;
      }

      if (message.type === "APK_DEPLOYED") {
        setTelemetry((prev) =>
          [
            `[ANR] deployed package=${message.packageName} mount=${message.mountPath} total=${message.installedCount}`,
            ...prev,
          ].slice(0, 120),
        );
        return;
      }

      if (message.type === "ANDROID_ACTIVITY_STARTED") {
        setTelemetry((prev) =>
          [
            `[ANR] started appId=${message.appId} package=${message.packageName} class=${message.className}`,
            ...prev,
          ].slice(0, 120),
        );
        return;
      }

      if (message.type === "OS_SUSPENDED") {
        setStatusText("Kernel suspended");
        return;
      }

      if (message.type === "OS_RESUMED") {
        setStatusText("Kernel resumed");
        setSessionId(message.sessionId);
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
        metricsBuffer,
        terminalBuffer,
        editorBuffer,
        mediaBuffer,
        fileExplorerBuffer,
        hardwareHalBuffer,
        virtualWidth: DEFAULT_VIRTUAL_WIDTH,
        virtualHeight: DEFAULT_VIRTUAL_HEIGHT,
      },
    });

    return () => {
      worker.postMessage({ type: "SUSPEND_OS" } satisfies UiToWorker);
      worker.postMessage({ type: "SHUTDOWN" } satisfies UiToWorker);
      worker.terminate();
      workerRef.current = null;
    };
  }, [
    editorBuffer,
    fileExplorerBuffer,
    hardwareHalBuffer,
    inputRingBuffer,
    launchApp,
    mediaBuffer,
    metricsBuffer,
    renderTreeBuffer,
    terminalBuffer,
  ]);

  useEffect(() => {
    if (!displayFullscreen) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDisplayFullscreen(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [displayFullscreen]);

  return (
    <main className={`shell ${displayFullscreen ? "shell-display-fullscreen" : ""}`}>
      <header className="shell-header">
        <p className="eyebrow">The Everywhere Nomadic OS</p>
        <h1>Spatial Runtime Control Surface</h1>
        <p className="summary">
          The Next.js layer is only a viewport and sync dashboard. Core session logic,
          dirty-page tracking, and window composition all execute inside a WASM kernel
          hosted by dedicated workers.
        </p>
      </header>

        <AppBar
          status={statusText}
          activeApps={systemMetrics.activeApps}
          dirtyPages={systemMetrics.dirtyPages}
          syncStatus={systemMetrics.syncStatus}
          onOpenLauncher={() => setLauncherOpen(true)}
          onLaunch={launchApp}
          onCheckpoint={() => postWorker({ type: "REQUEST_CHECKPOINT" })}
          onSuspend={() => postWorker({ type: "SUSPEND_OS" })}
          onResume={() => postWorker({ type: "RESUME_OS", sessionId })}
          onClearReplay={() => postWorker({ type: "CLEAR_SESSION_CACHE", sessionId })}
        />

      <section className={`workspace-grid ${displayFullscreen ? "fullscreen" : ""}`}>
        <div className={`workspace-display ${displayFullscreen ? "fullscreen" : ""}`}>
          <div className="workspace-display-controls">
            <button
              type="button"
              onClick={() => setDisplayFullscreen((prev) => !prev)}
              aria-label={displayFullscreen ? "Exit fullscreen viewport" : "Enter fullscreen viewport"}
            >
              {displayFullscreen ? "Exit Fullscreen (Esc)" : "Fullscreen"}
            </button>
          </div>
          <SpatialDisplay
            inputRingBuffer={inputRingBuffer}
            renderTreeBuffer={renderTreeBuffer}
            virtualWidth={DEFAULT_VIRTUAL_WIDTH}
            virtualHeight={DEFAULT_VIRTUAL_HEIGHT}
            onMetrics={handleDisplayMetrics}
          />
        </div>

        {!displayFullscreen ? (
          <div className="workspace-sidebar">
            <OsTerminal
              status={statusText}
              sessionId={sessionId}
              deltaBytes={deltaBytes}
              fps={fps}
              inputBacklog={inputBacklog}
              inputDropped={inputDropped}
              telemetry={telemetry}
            />
            <SettingsApp
              metrics={systemMetrics}
              hardwareHalBuffer={hardwareHalBuffer}
              onCheckpoint={() => postWorker({ type: "REQUEST_CHECKPOINT" })}
              onClearReplay={() => postWorker({ type: "CLEAR_SESSION_CACHE", sessionId })}
              onFlushOpfs={flushOpfs}
            />
          </div>
        ) : null}
      </section>

      <section className="sys-app-grid">
        <TerminalView terminalBuffer={terminalBuffer} onSendKey={sendTerminalKey} />
        <EditorView editorBuffer={editorBuffer} onSendKey={sendEditorKey} />
        <FileExplorerView
          fileExplorerBuffer={fileExplorerBuffer}
          onLaunch={launchApp}
          onLaunchApk={launchApk}
        />
        <APKInstaller onInstallRequest={installApk} />
        <PhotoViewer fileExplorerBuffer={fileExplorerBuffer} onLaunch={launchApp} />
        <ScreenCapApp mediaBuffer={mediaBuffer} onLaunch={launchApp} />
        <VoiceRecApp mediaBuffer={mediaBuffer} onLaunch={launchApp} />
        <AudioPlayerView mediaBuffer={mediaBuffer} onLaunch={launchApp} />
      </section>

      <AppLauncher
        open={launcherOpen}
        apps={apps}
        onLaunch={launchApp}
        onClose={() => setLauncherOpen(false)}
      />
    </main>
  );
}
