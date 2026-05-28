"use client";

import {
  APP_KIND_AUDIO_PLAYER,
  APP_KIND_EDITOR,
  APP_KIND_FILE_EXPLORER,
  APP_KIND_LAUNCHER,
  APP_KIND_PHOTO_VIEWER,
  APP_KIND_SCREEN_CAPTURE,
  APP_KIND_SETTINGS,
  APP_KIND_TERMINAL,
  APP_KIND_VOICE_RECORDER,
} from "@/lib/spatialShared";

type RuntimeAppDescriptor = {
  appId: number;
  windowId: number;
  kind: number;
  status: number;
  arenaOffset: number;
  arenaLen: number;
};

type LauncherCard = {
  kind: number;
  title: string;
  tagline: string;
};

type AppLauncherProps = {
  open: boolean;
  apps: RuntimeAppDescriptor[];
  onLaunch: (kind: number) => void;
  onClose: () => void;
};

const CARDS: LauncherCard[] = [
  {
    kind: APP_KIND_TERMINAL,
    title: "Terminal",
    tagline: "Kernel shell with command routing and telemetry taps.",
  },
  {
    kind: APP_KIND_EDITOR,
    title: "Editor",
    tagline: "Low-latency text surface backed by the WASM state machine.",
  },
  {
    kind: APP_KIND_SETTINGS,
    title: "Settings",
    tagline: "Tune sync cadence and runtime layout behavior.",
  },
  {
    kind: APP_KIND_LAUNCHER,
    title: "Launcher",
    tagline: "Spawn a compact app switcher window in the compositor.",
  },
  {
    kind: APP_KIND_FILE_EXPLORER,
    title: "File Explorer",
    tagline: "Visualize VFS directory paths and sync queue states.",
  },
  {
    kind: APP_KIND_PHOTO_VIEWER,
    title: "Photo Viewer",
    tagline: "Vector/canvas surface for image decode output.",
  },
  {
    kind: APP_KIND_SCREEN_CAPTURE,
    title: "Screen Capture",
    tagline: "Capture composited windows to raw in-memory frames.",
  },
  {
    kind: APP_KIND_VOICE_RECORDER,
    title: "Voice Recorder",
    tagline: "Stream microphone-like PCM through the media pipeline.",
  },
  {
    kind: APP_KIND_AUDIO_PLAYER,
    title: "Audio Player",
    tagline: "Route decoded PCM into the media output queue.",
  },
];

function appKindLabel(kind: number): string {
  if (kind === APP_KIND_TERMINAL) {
    return "Terminal";
  }

  if (kind === APP_KIND_EDITOR) {
    return "Editor";
  }

  if (kind === APP_KIND_SETTINGS) {
    return "Settings";
  }

  if (kind === APP_KIND_LAUNCHER) {
    return "Launcher";
  }

  if (kind === APP_KIND_FILE_EXPLORER) {
    return "File Explorer";
  }

  if (kind === APP_KIND_PHOTO_VIEWER) {
    return "Photo Viewer";
  }

  if (kind === APP_KIND_SCREEN_CAPTURE) {
    return "Screen Capture";
  }

  if (kind === APP_KIND_VOICE_RECORDER) {
    return "Voice Recorder";
  }

  if (kind === APP_KIND_AUDIO_PLAYER) {
    return "Audio Player";
  }

  return `App ${kind}`;
}

export default function AppLauncher({ open, apps, onLaunch, onClose }: AppLauncherProps) {
  if (!open) {
    return null;
  }

  return (
    <section className="sys-launcher-overlay" role="dialog" aria-modal="true" aria-label="App launcher">
      <div className="sys-launcher">
        <header>
          <h2>Built-in Suite</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="sys-launcher-grid">
          {CARDS.map((card) => (
            <button
              key={card.kind}
              type="button"
              className="sys-launcher-card"
              onClick={() => {
                onLaunch(card.kind);
                onClose();
              }}
            >
              <strong>{card.title}</strong>
              <span>{card.tagline}</span>
            </button>
          ))}
        </div>

        <div className="sys-running-list">
          <h3>Running instances</h3>
          {apps.length === 0 ? (
            <p>No live apps yet.</p>
          ) : (
            <ul>
              {apps.map((app) => (
                <li key={app.appId}>
                  <span>{appKindLabel(app.kind)}</span>
                  <span>#{app.appId}</span>
                  <span>window {app.windowId}</span>
                  <span>status {app.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
