import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { integrateSpring } from "@/components/SpatialDisplay";
import {
  INPUT_CAPACITY_INDEX,
  INPUT_DROPPED_INDEX,
  INPUT_EVENT_A_OFFSET,
  INPUT_EVENT_B_OFFSET,
  INPUT_EVENT_MOD_OFFSET,
  INPUT_EVENT_TYPE_OFFSET,
  INPUT_HEADER_BYTES,
  INPUT_HEADER_INTS,
  INPUT_READ_INDEX,
  INPUT_SLOT_BYTES,
  INPUT_WRITE_INDEX,
  createInputRingBuffer,
  createInputRingViews,
  pushInputPacket,
  ringBacklog,
} from "@/lib/spatialShared";

type WorkerResult = {
  pushed: number;
  dropped: number;
};

function runWriterWorker(
  shared: SharedArrayBuffer,
  workerId: number,
  iterations: number,
): Promise<WorkerResult> {
  const script = `
    const { parentPort, workerData } = require("node:worker_threads");

    const header = new Int32Array(workerData.shared, 0, workerData.headerInts);
    const data = new DataView(workerData.shared, workerData.headerBytes);

    const WRITE = ${INPUT_WRITE_INDEX};
    const READ = ${INPUT_READ_INDEX};
    const DROPPED = ${INPUT_DROPPED_INDEX};
    const CAPACITY = ${INPUT_CAPACITY_INDEX};

    let pushed = 0;
    let dropped = 0;

    for (let i = 0; i < workerData.iterations; i += 1) {
      let committed = false;
      for (let spin = 0; spin < 128; spin += 1) {
        const read = Atomics.load(header, READ) >>> 0;
        const write = Atomics.load(header, WRITE) >>> 0;
        const capacity = Atomics.load(header, CAPACITY) >>> 0;

        if (write - read >= capacity) {
          Atomics.add(header, DROPPED, 1);
          dropped += 1;
          committed = true;
          break;
        }

        if (Atomics.compareExchange(header, WRITE, write | 0, (write + 1) | 0) === (write | 0)) {
          const slot = write % capacity;
          const offset = slot * workerData.slotBytes;
          data.setUint32(offset + ${INPUT_EVENT_TYPE_OFFSET}, 200 + workerData.workerId, true);
          data.setFloat32(offset + ${INPUT_EVENT_A_OFFSET}, i * 0.25, true);
          data.setFloat32(offset + ${INPUT_EVENT_B_OFFSET}, i * 0.5, true);
          data.setUint32(offset + ${INPUT_EVENT_MOD_OFFSET}, workerData.workerId, true);
          pushed += 1;
          committed = true;
          break;
        }
      }

      if (!committed) {
        Atomics.add(header, DROPPED, 1);
        dropped += 1;
      }
    }

    parentPort.postMessage({ pushed, dropped });
  `;

  return new Promise<WorkerResult>((resolveWorker, rejectWorker) => {
    const worker = new Worker(script, {
      eval: true,
      workerData: {
        shared,
        workerId,
        iterations,
        headerInts: INPUT_HEADER_INTS,
        headerBytes: INPUT_HEADER_BYTES,
        slotBytes: INPUT_SLOT_BYTES,
      },
    });

    worker.once("message", (message: WorkerResult) => resolveWorker(message));
    worker.once("error", rejectWorker);
    worker.once("exit", (code) => {
      if (code !== 0) {
        rejectWorker(new Error(`worker exited with code ${code}`));
      }
    });
  });
}

describe("Shared Memory Concurrency Validation", () => {
  it("keeps atomic ring pointers consistent under multi-worker contention", async () => {
    const inputRing = createInputRingBuffer(1024);
    const header = new Int32Array(inputRing, 0, INPUT_HEADER_INTS);
    const data = new DataView(inputRing, INPUT_HEADER_BYTES);

    const workers = await Promise.all(
      Array.from({ length: 6 }, (_, index) => runWriterWorker(inputRing, index, 3000)),
    );

    const pushedTotal = workers.reduce((sum, result) => sum + result.pushed, 0);
    const droppedTotal = workers.reduce((sum, result) => sum + result.dropped, 0);

    const write = Atomics.load(header, INPUT_WRITE_INDEX) >>> 0;
    const read = Atomics.load(header, INPUT_READ_INDEX) >>> 0;
    const dropped = Atomics.load(header, INPUT_DROPPED_INDEX) >>> 0;
    const capacity = Atomics.load(header, INPUT_CAPACITY_INDEX) >>> 0;

    expect(write).toBe(pushedTotal);
    expect(dropped).toBe(droppedTotal);
    expect(write - read).toBeLessThanOrEqual(capacity);

    for (let index = 0; index < Math.min(write, capacity); index += 1) {
      const offset = index * INPUT_SLOT_BYTES;
      const eventType = data.getUint32(offset + INPUT_EVENT_TYPE_OFFSET, true);
      const paramA = data.getFloat32(offset + INPUT_EVENT_A_OFFSET, true);
      const paramB = data.getFloat32(offset + INPUT_EVENT_B_OFFSET, true);

      expect(eventType).toBeGreaterThanOrEqual(200);
      expect(eventType).toBeLessThan(210);
      expect(Number.isFinite(paramA)).toBe(true);
      expect(Number.isFinite(paramB)).toBe(true);
    }
  });

  it("sustains a high-frequency 1000Hz-like input stream with bounded drops", () => {
    const totalEvents = 12_000;
    const inputRing = createInputRingBuffer(2048);
    const views = createInputRingViews(inputRing);

    let successful = 0;
    let consumed = 0;

    const consume = (batch: number) => {
      const capacity = Atomics.load(views.header, INPUT_CAPACITY_INDEX) >>> 0;
      for (let i = 0; i < batch; i += 1) {
        const read = Atomics.load(views.header, INPUT_READ_INDEX) >>> 0;
        const write = Atomics.load(views.header, INPUT_WRITE_INDEX) >>> 0;
        if (read === write) {
          return;
        }

        const slot = read % capacity;
        const offset = slot * INPUT_SLOT_BYTES;
        const eventType = views.data.getUint32(offset + INPUT_EVENT_TYPE_OFFSET, true);

        expect([16, 17, 18]).toContain(eventType);
        Atomics.store(views.header, INPUT_READ_INDEX, (read + 1) | 0);
        consumed += 1;
      }
    };

    for (let i = 0; i < totalEvents; i += 1) {
      const eventType = i % 3 === 0 ? 16 : i % 3 === 1 ? 17 : 18;
      const ok = pushInputPacket(views, {
        eventType,
        paramA: i * 0.1,
        paramB: i * 0.2,
        modifierFlags: i & 0xf,
      });
      if (ok) {
        successful += 1;
      }

      if (i % 2 === 0) {
        consume(2);
      }
    }

    while (ringBacklog(views.header) > 0) {
      consume(64);
    }

    const dropped = Atomics.load(views.header, INPUT_DROPPED_INDEX) >>> 0;
    expect(consumed).toBe(successful);
    expect(dropped).toBeLessThan(totalEvents / 8);
    expect(ringBacklog(views.header)).toBe(0);
  });
});

describe("Viewport Rendering & Physics Performance", () => {
  it("spring equation converges without NaN or infinite oscillation", () => {
    let value = 320;
    let velocity = 0;
    const target = 0;

    for (let i = 0; i < 480; i += 1) {
      [value, velocity] = integrateSpring(value, velocity, target, 1 / 120);
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isFinite(velocity)).toBe(true);
    }

    expect(Math.abs(value)).toBeLessThan(0.1);
    expect(Math.abs(velocity)).toBeLessThan(0.1);
  });

  it("SpatialDisplay remains imperative with no React state-driven frame loop", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/SpatialDisplay.tsx"), "utf8");

    expect(source.includes("requestAnimationFrame")).toBe(true);
    expect(source.includes(".style.transform")).toBe(true);
    expect(source.includes("useRef(")).toBe(true);
    expect(source.includes("useState(")).toBe(false);
    expect(source.includes("setState(")).toBe(false);
  });
});
