"use client";

import {
  APP_KIND_PHOTO_VIEWER,
  FILES_HEADER_INTS,
  FILES_TEXT_BYTES_OFFSET,
  FILES_TEXT_LEN_INDEX,
} from "@/lib/spatialShared";
import { useEffect, useMemo, useRef, useState } from "react";

type PhotoViewerProps = {
  fileExplorerBuffer: SharedArrayBuffer;
  onLaunch: (kind: number) => void;
};

type OffsetState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export default function PhotoViewer({ fileExplorerBuffer, onLaunch }: PhotoViewerProps) {
  const decoder = useMemo(() => new TextDecoder(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const offsetRef = useRef<OffsetState>({ x: 0, y: 0, vx: 0, vy: 0 });
  const [libraryCount, setLibraryCount] = useState(0);

  useEffect(() => {
    const header = new Int32Array(fileExplorerBuffer, 0, FILES_HEADER_INTS);
    const bytes = new Uint8Array(fileExplorerBuffer, FILES_TEXT_BYTES_OFFSET);

    const interval = window.setInterval(() => {
      const textLen = Math.max(0, Math.min(Atomics.load(header, FILES_TEXT_LEN_INDEX), bytes.byteLength));
      const text = decoder.decode(bytes.subarray(0, textLen));
      const candidates = text
        .split("\n")
        .filter((line) => line.includes(".png") || line.includes(".jpg") || line.includes(".jpeg") || line.includes(".webp"));
      setLibraryCount(candidates.length);
    }, 120);

    return () => {
      window.clearInterval(interval);
    };
  }, [decoder, fileExplorerBuffer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    let raf = 0;
    const animate = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const state = offsetRef.current;

      if (!pointerRef.current.active) {
        state.x += state.vx;
        state.y += state.vy;
        state.vx *= 0.92;
        state.vy *= 0.92;
      }

      context.clearRect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#0b2034");
      gradient.addColorStop(1, "#07111e");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(state.x, state.y);
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          const x = col * 96 + 24;
          const y = row * 78 + 26;
          context.fillStyle = `hsla(${(row * 90 + col * 32) % 360}, 72%, 62%, 0.66)`;
          context.fillRect(x, y, 76, 56);
        }
      }
      context.restore();

      raf = window.requestAnimationFrame(animate);
    };

    raf = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <section className="sys-card photo-viewer-app" aria-label="Photo viewer app">
      <header>
        <h2>Photo Viewer</h2>
        <p>indexed assets {libraryCount}</p>
      </header>
      <canvas
        ref={canvasRef}
        className="photo-canvas"
        onPointerDown={(event) => {
          pointerRef.current = { active: true, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (!pointerRef.current.active) {
            return;
          }

          const dx = event.clientX - pointerRef.current.x;
          const dy = event.clientY - pointerRef.current.y;
          pointerRef.current.x = event.clientX;
          pointerRef.current.y = event.clientY;

          offsetRef.current.x += dx;
          offsetRef.current.y += dy;
          offsetRef.current.vx = dx * 0.25;
          offsetRef.current.vy = dy * 0.25;
        }}
        onPointerUp={() => {
          pointerRef.current.active = false;
        }}
        onPointerLeave={() => {
          pointerRef.current.active = false;
        }}
      />
      <div className="media-actions">
        <button type="button" onClick={() => onLaunch(APP_KIND_PHOTO_VIEWER)}>
          Launch Decoder Runtime
        </button>
      </div>
    </section>
  );
}
