"use client";

import {
  DEFAULT_VIRTUAL_HEIGHT,
  DEFAULT_VIRTUAL_WIDTH,
  INPUT_CAPACITY_INDEX,
  INPUT_DROPPED_INDEX,
  INPUT_HEADER_BYTES,
  INPUT_HEADER_INTS,
  INPUT_READ_INDEX,
  INPUT_SLOT_BYTES,
  INPUT_WRITE_INDEX,
  MAX_RENDER_NODES,
  RENDER_HEADER_BYTES,
  RENDER_HEADER_INTS,
  RENDER_NODE_COUNT_INDEX,
  RENDER_SEQUENCE_INDEX,
  WINDOW_NODE_STRIDE,
  ringBacklog,
} from "@/lib/spatialShared";
import { useEffect, useMemo, useRef } from "react";

const MAX_WINDOWS = 24;

const EVENT_TYPE_OFFSET = 0;
const EVENT_A_OFFSET = 4;
const EVENT_B_OFFSET = 8;
const EVENT_MOD_OFFSET = 12;
const EVENT_TIME_LOW_OFFSET = 16;
const EVENT_TIME_HIGH_OFFSET = 20;

const WINDOW_ID_OFFSET = 0;
const WINDOW_X_OFFSET = 4;
const WINDOW_Y_OFFSET = 8;
const WINDOW_W_OFFSET = 12;
const WINDOW_H_OFFSET = 16;
const WINDOW_Z_OFFSET = 20;
const WINDOW_FLAGS_OFFSET = 24;
const WINDOW_OPACITY_OFFSET = 28;
const WINDOW_ALPHA_OFFSET = 32;
const WINDOW_BLUR_OFFSET = 36;
const WINDOW_TRANSFORM_OFFSET = 40;

type WindowNode = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zOrder: number;
  flags: number;
  opacity: number;
  alpha: number;
  blurRadius: number;
  transform: [number, number, number, number, number, number];
};

type SpringWindowState = {
  id: number;
  zOrder: number;
  flags: number;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  topacity: number;
  talpha: number;
  tblur: number;
  tdepth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  alpha: number;
  blur: number;
  depth: number;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  vopacity: number;
  valpha: number;
  vblur: number;
  vdepth: number;
};

type SpatialMetrics = {
  fps: number;
  backlog: number;
  dropped: number;
};

type SpatialDisplayProps = {
  inputRingBuffer: SharedArrayBuffer;
  renderTreeBuffer: SharedArrayBuffer;
  virtualWidth?: number;
  virtualHeight?: number;
  onMetrics?: (metrics: SpatialMetrics) => void;
};

function pointerModifiers(event: MouseEvent | PointerEvent | WheelEvent | TouchEvent): number {
  let flags = 0;
  if (event.shiftKey) {
    flags |= 1 << 0;
  }
  if (event.altKey) {
    flags |= 1 << 1;
  }
  if (event.ctrlKey) {
    flags |= 1 << 2;
  }
  if (event.metaKey) {
    flags |= 1 << 3;
  }

  const buttons = (event as MouseEvent).buttons;
  if (typeof buttons === "number") {
    flags |= (buttons & 0xff) << 8;
  }

  return flags;
}

function keyboardModifiers(event: KeyboardEvent): number {
  let flags = 0;
  if (event.shiftKey) {
    flags |= 1 << 0;
  }
  if (event.altKey) {
    flags |= 1 << 1;
  }
  if (event.ctrlKey) {
    flags |= 1 << 2;
  }
  if (event.metaKey) {
    flags |= 1 << 3;
  }
  return flags;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function integrateSpring(value: number, velocity: number, target: number, dt: number): [number, number] {
  const stiffness = 220;
  const damping = 30;
  const displacement = value - target;
  const force = -stiffness * displacement - damping * velocity;
  const nextVelocity = velocity + force * dt;
  const nextValue = value + nextVelocity * dt;
  return [nextValue, nextVelocity];
}

function toUint32Counter(value: number): number {
  return value >>> 0;
}

export default function SpatialDisplay({
  inputRingBuffer,
  renderTreeBuffer,
  virtualWidth = DEFAULT_VIRTUAL_WIDTH,
  virtualHeight = DEFAULT_VIRTUAL_HEIGHT,
  onMetrics,
}: SpatialDisplayProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const windowRefs = useRef<Array<HTMLElement | null>>(
    Array.from({ length: MAX_WINDOWS }, () => null),
  );
  const titleRefs = useRef<Array<HTMLSpanElement | null>>(
    Array.from({ length: MAX_WINDOWS }, () => null),
  );
  const metricRefs = useRef<Array<HTMLSpanElement | null>>(
    Array.from({ length: MAX_WINDOWS }, () => null),
  );

  const inputHeaderRef = useRef<Int32Array | null>(null);
  const inputDataRef = useRef<DataView | null>(null);
  const renderHeaderRef = useRef<Int32Array | null>(null);
  const renderDataRef = useRef<DataView | null>(null);

  const lastRenderSequenceRef = useRef<number>(-1);
  const targetNodesRef = useRef<WindowNode[]>([]);
  const springStateRef = useRef<Map<number, SpringWindowState>>(new Map());

  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastFrameTsRef = useRef<number>(performance.now());
  const frameCounterRef = useRef(0);
  const fpsLastTsRef = useRef(performance.now());

  const pooledIndices = useMemo(() => Array.from({ length: MAX_WINDOWS }, (_, index) => index), []);

  useEffect(() => {
    inputHeaderRef.current = new Int32Array(inputRingBuffer, 0, INPUT_HEADER_INTS);
    inputDataRef.current = new DataView(inputRingBuffer, INPUT_HEADER_BYTES);

    renderHeaderRef.current = new Int32Array(renderTreeBuffer, 0, RENDER_HEADER_INTS);
    renderDataRef.current = new DataView(renderTreeBuffer);
  }, [inputRingBuffer, renderTreeBuffer]);

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      return;
    }

    const syncCanvasSize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const decodeRenderNodes = (): void => {
      const renderHeader = renderHeaderRef.current;
      const renderData = renderDataRef.current;
      if (!renderHeader || !renderData) {
        return;
      }

      const sequence = Atomics.load(renderHeader, RENDER_SEQUENCE_INDEX);
      if (sequence === lastRenderSequenceRef.current) {
        return;
      }

      lastRenderSequenceRef.current = sequence;
      const count = clamp(
        Atomics.load(renderHeader, RENDER_NODE_COUNT_INDEX),
        0,
        MAX_RENDER_NODES,
      );

      const nodes: WindowNode[] = [];
      for (let i = 0; i < count; i += 1) {
        const base = RENDER_HEADER_BYTES + i * WINDOW_NODE_STRIDE;

        const id = renderData.getUint32(base + WINDOW_ID_OFFSET, true);
        if (id === 0) {
          continue;
        }

        nodes.push({
          id,
          x: renderData.getFloat32(base + WINDOW_X_OFFSET, true),
          y: renderData.getFloat32(base + WINDOW_Y_OFFSET, true),
          width: renderData.getFloat32(base + WINDOW_W_OFFSET, true),
          height: renderData.getFloat32(base + WINDOW_H_OFFSET, true),
          zOrder: renderData.getUint32(base + WINDOW_Z_OFFSET, true),
          flags: renderData.getUint32(base + WINDOW_FLAGS_OFFSET, true),
          opacity: renderData.getFloat32(base + WINDOW_OPACITY_OFFSET, true),
          alpha: renderData.getFloat32(base + WINDOW_ALPHA_OFFSET, true),
          blurRadius: renderData.getFloat32(base + WINDOW_BLUR_OFFSET, true),
          transform: [
            renderData.getFloat32(base + WINDOW_TRANSFORM_OFFSET + 0, true),
            renderData.getFloat32(base + WINDOW_TRANSFORM_OFFSET + 4, true),
            renderData.getFloat32(base + WINDOW_TRANSFORM_OFFSET + 8, true),
            renderData.getFloat32(base + WINDOW_TRANSFORM_OFFSET + 12, true),
            renderData.getFloat32(base + WINDOW_TRANSFORM_OFFSET + 16, true),
            renderData.getFloat32(base + WINDOW_TRANSFORM_OFFSET + 20, true),
          ],
        });
      }

      targetNodesRef.current = nodes.sort((a, b) => a.zOrder - b.zOrder);
    };

    const drawBackground = (timeMs: number): void => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const wash = context.createLinearGradient(0, 0, width, height);
      wash.addColorStop(0, "#07101a");
      wash.addColorStop(0.45, "#0b1c2d");
      wash.addColorStop(1, "#09111e");
      context.fillStyle = wash;
      context.fillRect(0, 0, width, height);

      const t = timeMs * 0.00028;
      context.fillStyle = "rgba(171, 228, 255, 0.1)";
      for (let y = 0; y < height; y += 34) {
        for (let x = 0; x < width; x += 34) {
          const shimmer = 0.06 + 0.04 * Math.sin((x + y) * 0.03 + t);
          context.globalAlpha = shimmer;
          context.fillRect(x, y, 1.2, 1.2);
        }
      }
      context.globalAlpha = 1;

      const ambient = context.createRadialGradient(
        width * 0.58,
        height * 0.42,
        28,
        width * 0.58,
        height * 0.42,
        width * 0.56,
      );
      ambient.addColorStop(0, "rgba(130, 201, 255, 0.25)");
      ambient.addColorStop(1, "rgba(130, 201, 255, 0)");
      context.fillStyle = ambient;
      context.fillRect(0, 0, width, height);
    };

    const animate = (frameTs: number) => {
      decodeRenderNodes();
      syncCanvasSize();
      drawBackground(frameTs);

      const dt = Math.min((frameTs - lastFrameTsRef.current) / 1000, 0.05);
      lastFrameTsRef.current = frameTs;

      const states = springStateRef.current;
      const targets = targetNodesRef.current;

      for (const target of targets) {
        const focusDepth = (target.flags & 1) !== 0 ? 42 : -8;
        const state = states.get(target.id) ?? {
          id: target.id,
          zOrder: target.zOrder,
          flags: target.flags,
          tx: target.x,
          ty: target.y,
          tw: target.width,
          th: target.height,
          topacity: target.opacity,
          talpha: target.alpha,
          tblur: target.blurRadius,
          tdepth: focusDepth,
          x: target.x,
          y: target.y,
          w: target.width,
          h: target.height,
          opacity: target.opacity,
          alpha: target.alpha,
          blur: target.blurRadius,
          depth: focusDepth,
          vx: 0,
          vy: 0,
          vw: 0,
          vh: 0,
          vopacity: 0,
          valpha: 0,
          vblur: 0,
          vdepth: 0,
        };

        state.zOrder = target.zOrder;
        state.flags = target.flags;
        state.tx = target.x + target.transform[4];
        state.ty = target.y + target.transform[5];
        state.tw = target.width;
        state.th = target.height;
        state.topacity = clamp(target.opacity, 0.15, 1);
        state.talpha = clamp(target.alpha, 0.15, 1);
        state.tblur = clamp(target.blurRadius, 0, 52);
        state.tdepth = focusDepth;

        [state.x, state.vx] = integrateSpring(state.x, state.vx, state.tx, dt);
        [state.y, state.vy] = integrateSpring(state.y, state.vy, state.ty, dt);
        [state.w, state.vw] = integrateSpring(state.w, state.vw, state.tw, dt);
        [state.h, state.vh] = integrateSpring(state.h, state.vh, state.th, dt);
        [state.opacity, state.vopacity] = integrateSpring(state.opacity, state.vopacity, state.topacity, dt);
        [state.alpha, state.valpha] = integrateSpring(state.alpha, state.valpha, state.talpha, dt);
        [state.blur, state.vblur] = integrateSpring(state.blur, state.vblur, state.tblur, dt);
        [state.depth, state.vdepth] = integrateSpring(state.depth, state.vdepth, state.tdepth, dt);

        states.set(target.id, state);
      }

      const activeIds = new Set(targets.map((node) => node.id));
      for (const [id, state] of states) {
        if (activeIds.has(id)) {
          continue;
        }

        state.topacity = 0;
        [state.opacity, state.vopacity] = integrateSpring(state.opacity, state.vopacity, 0, dt);
        if (state.opacity < 0.02) {
          states.delete(id);
        }
      }

      const sortedStates = Array.from(states.values()).sort((a, b) => a.zOrder - b.zOrder);

      for (let i = 0; i < MAX_WINDOWS; i += 1) {
        const element = windowRefs.current[i];
        const title = titleRefs.current[i];
        const metric = metricRefs.current[i];
        if (!element || !title || !metric) {
          continue;
        }

        const state = sortedStates[i];
        if (!state) {
          element.style.opacity = "0";
          element.style.pointerEvents = "none";
          continue;
        }

        const nx = clamp(state.x / virtualWidth, 0, 1);
        const ny = clamp(state.y / virtualHeight, 0, 1);
        const shineAngle = 25 + nx * 130 - ny * 32;
        const glowStrength = (state.flags & 1) !== 0 ? 0.72 : 0.34;
        const edgeAlpha = 0.22 + glowStrength * 0.55;
        const shadowAlpha = 0.2 + glowStrength * 0.35;

        element.style.opacity = state.opacity.toFixed(3);
        element.style.width = `${Math.max(120, state.w)}px`;
        element.style.height = `${Math.max(90, state.h)}px`;
        element.style.transform = `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, ${state.depth.toFixed(2)}px)`;
        element.style.zIndex = `${40 + state.zOrder}`;
        element.style.setProperty("--shine-angle", `${shineAngle.toFixed(1)}deg`);
        element.style.setProperty("--edge-alpha", edgeAlpha.toFixed(3));
        element.style.setProperty("--window-alpha", state.alpha.toFixed(3));
        element.style.setProperty("--window-blur", `${state.blur.toFixed(2)}px`);
        element.style.boxShadow = `0 ${Math.max(8, state.depth * 0.6).toFixed(2)}px ${(
          32 + state.depth * 1.1
        ).toFixed(2)}px rgba(5, 11, 22, ${shadowAlpha.toFixed(3)})`;

        title.textContent = `Window ${state.id}`;
        metric.textContent = `${Math.round(state.w)}x${Math.round(state.h)} • z${state.zOrder}`;
      }

      frameCounterRef.current += 1;
      const elapsed = frameTs - fpsLastTsRef.current;
      if (elapsed >= 250) {
        const fps = (frameCounterRef.current * 1000) / elapsed;
        frameCounterRef.current = 0;
        fpsLastTsRef.current = frameTs;

        const inputHeader = inputHeaderRef.current;
        if (inputHeader && onMetrics) {
          onMetrics({
            fps,
            backlog: ringBacklog(inputHeader),
            dropped: Atomics.load(inputHeader, INPUT_DROPPED_INDEX),
          });
        }
      }

      rafIdRef.current = window.requestAnimationFrame(animate);
    };

    resizeObserverRef.current = new ResizeObserver(syncCanvasSize);
    resizeObserverRef.current.observe(canvas);
    syncCanvasSize();

    rafIdRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [onMetrics, virtualHeight, virtualWidth]);

  useEffect(() => {
    const shell = shellRef.current;
    const inputHeader = inputHeaderRef.current;
    const inputData = inputDataRef.current;
    if (!shell || !inputHeader || !inputData) {
      return;
    }

    const capacity = Atomics.load(inputHeader, INPUT_CAPACITY_INDEX) >>> 0;
    if (capacity === 0) {
      return;
    }

    const pushInputEvent = (
      eventType: number,
      paramA: number,
      paramB: number,
      modifierFlags: number,
    ): boolean => {
      const read = Atomics.load(inputHeader, INPUT_READ_INDEX) >>> 0;
      const write = Atomics.load(inputHeader, INPUT_WRITE_INDEX) >>> 0;
      if (write - read >= capacity) {
        Atomics.add(inputHeader, INPUT_DROPPED_INDEX, 1);
        return false;
      }

      const slot = write % capacity;
      const offset = slot * INPUT_SLOT_BYTES;
      const timestampNs = BigInt(Math.floor((performance.timeOrigin + performance.now()) * 1_000_000));

      inputData.setUint32(offset + EVENT_TYPE_OFFSET, toUint32Counter(eventType), true);
      inputData.setFloat32(offset + EVENT_A_OFFSET, paramA, true);
      inputData.setFloat32(offset + EVENT_B_OFFSET, paramB, true);
      inputData.setUint32(offset + EVENT_MOD_OFFSET, toUint32Counter(modifierFlags), true);
      inputData.setUint32(offset + EVENT_TIME_LOW_OFFSET, Number(timestampNs & 0xffffffffn), true);
      inputData.setUint32(offset + EVENT_TIME_HIGH_OFFSET, Number((timestampNs >> 32n) & 0xffffffffn), true);

      Atomics.store(inputHeader, INPUT_WRITE_INDEX, (write + 1) | 0);
      return true;
    };

    const mapToVirtual = (clientX: number, clientY: number): [number, number] => {
      const rect = shell.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * virtualWidth;
      const y = ((clientY - rect.top) / rect.height) * virtualHeight;
      return [clamp(x, 0, virtualWidth), clamp(y, 0, virtualHeight)];
    };

    const handlePointer = (event: PointerEvent) => {
      const [x, y] = mapToVirtual(event.clientX, event.clientY);
      pushInputEvent(0, x, y, pointerModifiers(event));
      if (event.type === "pointerdown") {
        shell.focus();
      }
    };

    const handleWheel = (event: WheelEvent) => {
      pushInputEvent(2, event.deltaX, event.deltaY, pointerModifiers(event));
    };

    const handleTouch = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) {
        return;
      }

      const [x, y] = mapToVirtual(touch.clientX, touch.clientY);
      pushInputEvent(2, x, y, pointerModifiers(event));
    };

    const handleKey = (event: KeyboardEvent) => {
      const keyCode = event.key.length === 1 ? event.key.charCodeAt(0) : event.keyCode;
      pushInputEvent(1, keyCode, event.repeat ? 1 : 0, keyboardModifiers(event));
    };

    shell.addEventListener("pointerdown", handlePointer, { passive: true });
    shell.addEventListener("pointermove", handlePointer, { passive: true });
    shell.addEventListener("pointerup", handlePointer, { passive: true });
    shell.addEventListener("wheel", handleWheel, { passive: true });
    shell.addEventListener("touchstart", handleTouch, { passive: true });
    shell.addEventListener("touchmove", handleTouch, { passive: true });
    window.addEventListener("keydown", handleKey);

    return () => {
      shell.removeEventListener("pointerdown", handlePointer);
      shell.removeEventListener("pointermove", handlePointer);
      shell.removeEventListener("pointerup", handlePointer);
      shell.removeEventListener("wheel", handleWheel);
      shell.removeEventListener("touchstart", handleTouch);
      shell.removeEventListener("touchmove", handleTouch);
      window.removeEventListener("keydown", handleKey);
    };
  }, [virtualHeight, virtualWidth]);

  return (
    <section className="display-shell" ref={shellRef} tabIndex={0} aria-label="Spatial desktop viewport">
      <canvas className="spatial-canvas" ref={canvasRef} width={1280} height={720} />
      <div className="glass-layer" aria-hidden="true">
        {pooledIndices.map((index) => (
          <article
            key={index}
            className="glass-window"
            ref={(node) => {
              windowRefs.current[index] = node;
            }}
          >
            <header className="glass-window-header">
              <span
                ref={(node) => {
                  titleRefs.current[index] = node;
                }}
              >
                Window
              </span>
              <i
                ref={(node) => {
                  metricRefs.current[index] = node;
                }}
              >
                0x0
              </i>
            </header>
            <div className="glass-window-body" />
          </article>
        ))}
      </div>
    </section>
  );
}
