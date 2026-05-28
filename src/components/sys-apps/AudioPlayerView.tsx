"use client";

import {
  APP_KIND_AUDIO_PLAYER,
  MEDIA_CAPTURE_SEQUENCE_INDEX,
  MEDIA_HEADER_INTS,
  MEDIA_PCM_HIGH_INDEX,
  MEDIA_PCM_LOW_INDEX,
  MEDIA_SEQUENCE_INDEX,
  MEDIA_STREAM_COUNT_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useRef, useState } from "react";

type AudioPlayerViewProps = {
  mediaBuffer: SharedArrayBuffer;
  onLaunch: (kind: number) => void;
};

type AudioState = {
  sequence: number;
  streams: number;
  totalSamples: bigint;
  captureSequence: number;
};

export default function AudioPlayerView({ mediaBuffer, onLaunch }: AudioPlayerViewProps) {
  const [audioState, setAudioState] = useState<AudioState>({
    sequence: 0,
    streams: 0,
    totalSamples: 0n,
    captureSequence: 0,
  });
  const [playing, setPlaying] = useState(false);
  const lastSequenceRef = useRef(0);

  useEffect(() => {
    const header = new Int32Array(mediaBuffer, 0, MEDIA_HEADER_INTS);

    const interval = window.setInterval(() => {
      const sequence = Atomics.load(header, MEDIA_SEQUENCE_INDEX);
      if (sequence === lastSequenceRef.current) {
        return;
      }

      lastSequenceRef.current = sequence;
      const low = Atomics.load(header, MEDIA_PCM_LOW_INDEX) >>> 0;
      const high = Atomics.load(header, MEDIA_PCM_HIGH_INDEX) >>> 0;

      setAudioState({
        sequence,
        streams: Atomics.load(header, MEDIA_STREAM_COUNT_INDEX),
        totalSamples: (BigInt(high) << 32n) | BigInt(low),
        captureSequence: Atomics.load(header, MEDIA_CAPTURE_SEQUENCE_INDEX),
      });
    }, 80);

    return () => {
      window.clearInterval(interval);
    };
  }, [mediaBuffer]);

  return (
    <section className="sys-card audio-player-app" aria-label="Audio player app">
      <header>
        <h2>Audio Player</h2>
        <p>
          streams {audioState.streams} samples {audioState.totalSamples.toString()}
        </p>
      </header>
      <pre>
        state: {playing ? "playing" : "paused"}
        {"\n"}
        media-seq: {audioState.sequence}
        {"\n"}
        frame-capture-seq: {audioState.captureSequence}
      </pre>
      <div className="media-actions">
        <button
          type="button"
          onClick={() => {
            onLaunch(APP_KIND_AUDIO_PLAYER);
            setPlaying((prev) => !prev);
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </section>
  );
}
