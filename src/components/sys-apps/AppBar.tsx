"use client";

import {
  APP_KIND_AUDIO_PLAYER,
  APP_KIND_EDITOR,
  APP_KIND_FILE_EXPLORER,
  APP_KIND_SETTINGS,
  APP_KIND_TERMINAL,
  APP_KIND_VOICE_RECORDER,
} from "@/lib/spatialShared";

type AppBarProps = {
  status: string;
  activeApps: number;
  dirtyPages: number;
  syncStatus: number;
  onOpenLauncher: () => void;
  onLaunch: (kind: number) => void;
  onCheckpoint: () => void;
  onSuspend: () => void;
  onResume: () => void;
  onClearReplay: () => void;
};

function syncStatusLabel(syncStatus: number): string {
  if (syncStatus < 0) {
    return "Sync fault";
  }

  if (syncStatus === 1) {
    return "Syncing";
  }

  if (syncStatus === 2) {
    return "Synced";
  }

  return "Idle";
}

export default function AppBar({
  status,
  activeApps,
  dirtyPages,
  syncStatus,
  onOpenLauncher,
  onLaunch,
  onCheckpoint,
  onSuspend,
  onResume,
  onClearReplay,
}: AppBarProps) {
  return (
    <section className="sys-app-bar" aria-label="System applications">
      <div className="sys-app-chip-row">
        <span className="sys-chip">{status}</span>
        <span className="sys-chip">Apps {activeApps}</span>
        <span className="sys-chip">Dirty {dirtyPages}</span>
        <span className="sys-chip">{syncStatusLabel(syncStatus)}</span>
      </div>
      <div className="sys-app-actions">
        <button type="button" onClick={onOpenLauncher}>
          Launcher
        </button>
        <button type="button" onClick={() => onLaunch(APP_KIND_TERMINAL)}>
          Terminal
        </button>
        <button type="button" onClick={() => onLaunch(APP_KIND_EDITOR)}>
          Editor
        </button>
        <button type="button" onClick={() => onLaunch(APP_KIND_SETTINGS)}>
          Settings
        </button>
        <button type="button" onClick={() => onLaunch(APP_KIND_FILE_EXPLORER)}>
          Files
        </button>
        <button type="button" onClick={() => onLaunch(APP_KIND_AUDIO_PLAYER)}>
          Player
        </button>
        <button type="button" onClick={() => onLaunch(APP_KIND_VOICE_RECORDER)}>
          Recorder
        </button>
        <button type="button" onClick={onCheckpoint}>
          Checkpoint
        </button>
        <button type="button" onClick={onSuspend}>
          Suspend
        </button>
        <button type="button" onClick={onResume}>
          Resume
        </button>
        <button type="button" onClick={onClearReplay}>
          Clear Replay
        </button>
      </div>
    </section>
  );
}
