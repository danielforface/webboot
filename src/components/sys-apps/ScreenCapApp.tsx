"use client";

import {
  APP_KIND_SCREEN_CAPTURE,
  MEDIA_CAPTURE_SEQUENCE_INDEX,
  MEDIA_HEADER_INTS,
  MEDIA_SEQUENCE_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useRef, useState } from "react";

type ScreenCapAppProps = {
  mediaBuffer: SharedArrayBuffer;
  onLaunch: (kind: number) => void;
};

export default function ScreenCapApp({ mediaBuffer, onLaunch }: ScreenCapAppProps) {
  const [captureSequence, setCaptureSequence] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [captures, setCaptures] = useState(0);
  const lastSequenceRef = useRef(0);

  useEffect(() => {
    const header = new Int32Array(mediaBuffer, 0, MEDIA_HEADER_INTS);

    const interval = window.setInterval(() => {
      const seq = Atomics.load(header, MEDIA_SEQUENCE_INDEX);
      if (seq === lastSequenceRef.current) {
        return;
      }

      lastSequenceRef.current = seq;
      setSequence(seq);
      setCaptureSequence(Atomics.load(header, MEDIA_CAPTURE_SEQUENCE_INDEX));
    }, 80);

    return () => {
      window.clearInterval(interval);
    };
  }, [mediaBuffer]);

  return (
    <section className="sys-card screencap-app" aria-label="Screen capture app">
      <header>
        <h2>Screen Capture</h2>
        <p>
          capture-seq {captureSequence} media-seq {sequence}
        </p>
      </header>
      <pre>
        captures this session: {captures}
        {"\n"}
        source: internal compositor frame buffer
      </pre>
      <div className="media-actions">
        <button
          type="button"
          onClick={() => {
            onLaunch(APP_KIND_SCREEN_CAPTURE);
            setCaptures((prev) => prev + 1);
          }}
        >
          Capture Active Window
        </button>
      </div>
    </section>
  );
}
