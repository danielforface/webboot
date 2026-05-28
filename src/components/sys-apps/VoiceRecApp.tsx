"use client";

import {
  APP_KIND_VOICE_RECORDER,
  MEDIA_HEADER_INTS,
  MEDIA_PCM_HIGH_INDEX,
  MEDIA_PCM_LOW_INDEX,
  MEDIA_SEQUENCE_INDEX,
  MEDIA_STREAM_COUNT_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useRef, useState } from "react";

type VoiceRecAppProps = {
  mediaBuffer: SharedArrayBuffer;
  onLaunch: (kind: number) => void;
};

export default function VoiceRecApp({ mediaBuffer, onLaunch }: VoiceRecAppProps) {
  const [recording, setRecording] = useState(false);
  const [streamCount, setStreamCount] = useState(0);
  const [totalSamples, setTotalSamples] = useState<bigint>(0n);
  const [sequence, setSequence] = useState(0);
  const lastSequenceRef = useRef(0);

  useEffect(() => {
    const header = new Int32Array(mediaBuffer, 0, MEDIA_HEADER_INTS);

    const interval = window.setInterval(() => {
      const seq = Atomics.load(header, MEDIA_SEQUENCE_INDEX);
      if (seq === lastSequenceRef.current) {
        return;
      }

      lastSequenceRef.current = seq;
      const low = Atomics.load(header, MEDIA_PCM_LOW_INDEX) >>> 0;
      const high = Atomics.load(header, MEDIA_PCM_HIGH_INDEX) >>> 0;

      setSequence(seq);
      setStreamCount(Atomics.load(header, MEDIA_STREAM_COUNT_INDEX));
      setTotalSamples((BigInt(high) << 32n) | BigInt(low));
    }, 80);

    return () => {
      window.clearInterval(interval);
    };
  }, [mediaBuffer]);

  return (
    <section className="sys-card voice-rec-app" aria-label="Voice recorder app">
      <header>
        <h2>Voice Recorder</h2>
        <p>
          stream-count {streamCount} seq {sequence}
        </p>
      </header>
      <pre>
        status: {recording ? "recording" : "idle"}
        {"\n"}
        buffered samples: {totalSamples.toString()}
      </pre>
      <div className="media-actions">
        <button
          type="button"
          onClick={() => {
            onLaunch(APP_KIND_VOICE_RECORDER);
            setRecording((prev) => !prev);
          }}
        >
          {recording ? "Stop" : "Record"}
        </button>
      </div>
    </section>
  );
}
