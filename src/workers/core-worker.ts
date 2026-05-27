/// <reference lib="webworker" />

export {};

import {
  DEFAULT_VIRTUAL_HEIGHT,
  DEFAULT_VIRTUAL_WIDTH,
  INPUT_CAPACITY_INDEX,
  INPUT_DROPPED_INDEX,
  INPUT_HEADER_BYTES,
  INPUT_HEADER_INTS,
  INPUT_READ_INDEX,
  INPUT_SEQUENCE_INDEX,
  INPUT_SLOT_BYTES,
  INPUT_WRITE_INDEX,
  MAX_RENDER_NODES,
  PAGE_SIZE,
  RENDER_ACTIVE_ID_INDEX,
  RENDER_HEADER_BYTES,
  RENDER_HEADER_INTS,
  RENDER_HEIGHT_INDEX,
  RENDER_NODE_COUNT_INDEX,
  RENDER_SEQUENCE_INDEX,
  RENDER_WIDTH_INDEX,
  WINDOW_NODE_STRIDE,
  ringBacklog,
} from "../lib/spatialShared";

const MAX_DELTA_PAGES = 64;
const SESSION_BUFFER_BYTES = 1024;
const DELTA_MAGIC = 0x444d4f4e;
const DELTA_VERSION = 1;
const INPUT_DRAIN_BUDGET = 512;

const EVENT_TYPE_OFFSET = 0;
const EVENT_A_OFFSET = 4;
const EVENT_B_OFFSET = 8;
const EVENT_MOD_OFFSET = 12;

const WINDOW_FLAGS_OFFSET = 24;
const WINDOW_ID_OFFSET = 0;

type InitPayload = {
  wasmUrl?: string;
  sessionId?: string;
  initialPages?: number;
  maximumPages?: number;
  flags?: number;
  virtualWidth?: number;
  virtualHeight?: number;
  inputRingBuffer?: SharedArrayBuffer;
  renderTreeBuffer?: SharedArrayBuffer;
};

type WorkerInputEvent = {
  eventType: number;
  paramA: number;
  paramB: number;
  modifierFlags: number;
};

type UiToWorker =
  | { type: "INIT_OS"; payload?: InitPayload }
  | { type: "POLL"; payload?: { deadlineNs?: number } }
  | { type: "PUSH_INPUT"; payload: WorkerInputEvent }
  | { type: "SUSPEND_OS" }
  | { type: "RESUME_OS"; payload?: { sessionId?: string } }
  | { type: "SHUTDOWN" };

type WorkerToUi =
  | { type: "OS_READY"; memoryBytes: number; sessionId: string }
  | { type: "DELTA_PUSHED"; bytes: number; pages: number }
  | { type: "OS_SUSPENDED" }
  | { type: "OS_RESUMED" }
  | { type: "TELEMETRY"; message: string }
  | { type: "OS_FAULT"; message: string };

interface CoreOsExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  os_boot: (ramBytes: number, flags: number) => number;
  os_suspend: () => number;
  os_resume: (sessionPtr: number, sessionLen: number) => number;
  os_process_input: (eventType: number, paramA: number, paramB: number, modifierFlags: number) => number;
  os_get_render_tree: (dstPtr: number, capacity: number) => number;
  os_collect_dirty_pages: (pageOutPtr: number, maxPages: number) => number;
  os_read_page: (pageIndex: number, dstPtr: number, dstLen: number) => number;
  os_write_page: (pageIndex: number, srcPtr: number, srcLen: number) => number;
  os_poll: (deadlineNs: bigint) => number;
  os_alloc: (len: number) => number;
  os_free: (ptr: number, len: number) => void;
}

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let wasmMemory: WebAssembly.Memory | null = null;
let instanceExports: CoreOsExports | null = null;
let initialized = false;
let sessionId = "default";

let virtualWidth = DEFAULT_VIRTUAL_WIDTH;
let virtualHeight = DEFAULT_VIRTUAL_HEIGHT;

let kernelLoopId: number | null = null;
let deltaLoopId: number | null = null;
let telemetryLoopId: number | null = null;

let pageIndexPtr = 0;
let pageScratchPtr = 0;
let renderTreePtr = 0;
let sessionPtr = 0;

let inputHeader: Int32Array | null = null;
let inputView: DataView | null = null;
let renderHeader: Int32Array | null = null;
let renderBytes: Uint8Array | null = null;

function emit(message: WorkerToUi): void {
  workerScope.postMessage(message);
}

function nowNs(): bigint {
  return BigInt(Math.floor((performance.timeOrigin + performance.now()) * 1_000_000));
}

function requireKernel(): CoreOsExports {
  if (!instanceExports || !wasmMemory) {
    throw new Error("Kernel is not initialized");
  }

  return instanceExports;
}

function readUtf8(ptr: number, len: number): string {
  if (!wasmMemory || ptr === 0 || len <= 0) {
    return "";
  }

  const bytes = new Uint8Array(wasmMemory.buffer, ptr, len);
  return textDecoder.decode(bytes);
}

function bindSharedBuffers(payload?: InitPayload): void {
  if (payload?.inputRingBuffer) {
    inputHeader = new Int32Array(payload.inputRingBuffer, 0, INPUT_HEADER_INTS);
    inputView = new DataView(payload.inputRingBuffer, INPUT_HEADER_BYTES);

    if ((Atomics.load(inputHeader, INPUT_CAPACITY_INDEX) >>> 0) === 0) {
      const slots = Math.floor((payload.inputRingBuffer.byteLength - INPUT_HEADER_BYTES) / INPUT_SLOT_BYTES);
      Atomics.store(inputHeader, INPUT_CAPACITY_INDEX, slots | 0);
    }
  }

  if (payload?.renderTreeBuffer) {
    renderHeader = new Int32Array(payload.renderTreeBuffer, 0, RENDER_HEADER_INTS);
    renderBytes = new Uint8Array(payload.renderTreeBuffer);
  }

  if (payload?.virtualWidth && payload.virtualWidth > 0) {
    virtualWidth = Math.floor(payload.virtualWidth);
  }
  if (payload?.virtualHeight && payload.virtualHeight > 0) {
    virtualHeight = Math.floor(payload.virtualHeight);
  }

  if (renderHeader) {
    Atomics.store(renderHeader, RENDER_WIDTH_INDEX, virtualWidth);
    Atomics.store(renderHeader, RENDER_HEIGHT_INDEX, virtualHeight);
  }
}

function writeSession(value: string): number {
  if (!wasmMemory || sessionPtr === 0) {
    return 0;
  }

  const encoded = textEncoder.encode(value);
  const len = Math.min(encoded.length, SESSION_BUFFER_BYTES - 1);
  const view = new Uint8Array(wasmMemory.buffer, sessionPtr, SESSION_BUFFER_BYTES);
  view.fill(0);
  view.set(encoded.subarray(0, len));
  return len;
}

function allocScratchBuffers(exportsObject: CoreOsExports): void {
  pageIndexPtr = exportsObject.os_alloc(MAX_DELTA_PAGES * Uint32Array.BYTES_PER_ELEMENT);
  pageScratchPtr = exportsObject.os_alloc(PAGE_SIZE);
  renderTreePtr = exportsObject.os_alloc(MAX_RENDER_NODES * WINDOW_NODE_STRIDE);
  sessionPtr = exportsObject.os_alloc(SESSION_BUFFER_BYTES);

  if (!pageIndexPtr || !pageScratchPtr || !renderTreePtr || !sessionPtr) {
    throw new Error("Unable to allocate kernel scratch buffers");
  }
}

async function pushSnapshot(payload: Uint8Array, kind: string): Promise<void> {
  const response = await fetch("/api/snapshot", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-session-id": sessionId,
      "x-payload-kind": kind,
    },
    body: payload,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Snapshot upload failed (${response.status})`);
  }
}

async function pullSnapshot(remoteSessionId: string): Promise<Uint8Array | null> {
  const response = await fetch(`/api/snapshot?sessionId=${encodeURIComponent(remoteSessionId)}`, {
    method: "GET",
    cache: "no-store",
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Snapshot fetch failed (${response.status})`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function applyDeltaPayload(payload: Uint8Array): number {
  if (!instanceExports || !wasmMemory || payload.byteLength < 12) {
    return 0;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const pageCount = view.getUint32(8, true);

  if (magic !== DELTA_MAGIC || version !== DELTA_VERSION) {
    return 0;
  }

  let cursor = 12;
  let restored = 0;

  for (let i = 0; i < pageCount; i += 1) {
    if (cursor + 8 > payload.byteLength) {
      break;
    }

    const pageIndex = view.getUint32(cursor, true);
    cursor += 4;
    const byteLength = view.getUint32(cursor, true);
    cursor += 4;

    if (byteLength > PAGE_SIZE || cursor + byteLength > payload.byteLength) {
      break;
    }

    const target = new Uint8Array(wasmMemory.buffer, pageScratchPtr, byteLength);
    target.set(payload.subarray(cursor, cursor + byteLength));
    cursor += byteLength;

    const rc = instanceExports.os_write_page(pageIndex, pageScratchPtr, byteLength);
    if (rc >= 0) {
      restored += 1;
    }
  }

  return restored;
}

async function flushDirtyPages(): Promise<void> {
  if (!instanceExports || !wasmMemory) {
    return;
  }

  const pageCount = instanceExports.os_collect_dirty_pages(pageIndexPtr, MAX_DELTA_PAGES);
  if (pageCount <= 0) {
    return;
  }

  const pageIndices = new Uint32Array(wasmMemory.buffer, pageIndexPtr, pageCount);
  const packet = new Uint8Array(12 + pageCount * (8 + PAGE_SIZE));
  const packetView = new DataView(packet.buffer);

  packetView.setUint32(0, DELTA_MAGIC, true);
  packetView.setUint32(4, DELTA_VERSION, true);
  packetView.setUint32(8, pageCount, true);

  let cursor = 12;
  for (let i = 0; i < pageCount; i += 1) {
    const page = pageIndices[i];
    packetView.setUint32(cursor, page, true);
    cursor += 4;
    packetView.setUint32(cursor, PAGE_SIZE, true);
    cursor += 4;

    const read = instanceExports.os_read_page(page, pageScratchPtr, PAGE_SIZE);
    if (read !== PAGE_SIZE) {
      packet.fill(0, cursor, cursor + PAGE_SIZE);
    } else {
      const pageBytes = new Uint8Array(wasmMemory.buffer, pageScratchPtr, PAGE_SIZE);
      packet.set(pageBytes, cursor);
    }

    cursor += PAGE_SIZE;
  }

  await pushSnapshot(packet.subarray(0, cursor), "delta");
  emit({
    type: "DELTA_PUSHED",
    bytes: cursor,
    pages: pageCount,
  });
}

function copyRenderTreeToShared(): void {
  if (!instanceExports || !wasmMemory || !renderHeader || !renderBytes) {
    return;
  }

  const countRaw = instanceExports.os_get_render_tree(renderTreePtr, MAX_RENDER_NODES);
  if (countRaw < 0) {
    emit({
      type: "OS_FAULT",
      message: `os_get_render_tree failed with code ${countRaw}`,
    });
    return;
  }

  const count = Math.min(countRaw, MAX_RENDER_NODES);
  const bytes = count * WINDOW_NODE_STRIDE;
  if (bytes > 0) {
    const source = new Uint8Array(wasmMemory.buffer, renderTreePtr, bytes);
    renderBytes.set(source, RENDER_HEADER_BYTES);
  }

  const view = new DataView(wasmMemory.buffer, renderTreePtr, bytes);
  let activeId = 0;
  for (let i = 0; i < count; i += 1) {
    const base = i * WINDOW_NODE_STRIDE;
    const flags = view.getUint32(base + WINDOW_FLAGS_OFFSET, true);
    if ((flags & 1) !== 0) {
      activeId = view.getUint32(base + WINDOW_ID_OFFSET, true);
      break;
    }
  }

  Atomics.store(renderHeader, RENDER_NODE_COUNT_INDEX, count);
  Atomics.store(renderHeader, RENDER_ACTIVE_ID_INDEX, activeId);
  Atomics.store(renderHeader, RENDER_WIDTH_INDEX, virtualWidth);
  Atomics.store(renderHeader, RENDER_HEIGHT_INDEX, virtualHeight);
  Atomics.add(renderHeader, RENDER_SEQUENCE_INDEX, 1);
}

function processInputFallback(event: WorkerInputEvent): void {
  if (!instanceExports) {
    return;
  }

  const rc = instanceExports.os_process_input(
    event.eventType,
    event.paramA,
    event.paramB,
    event.modifierFlags,
  );
  if (rc < 0) {
    emit({
      type: "OS_FAULT",
      message: `os_process_input failed with code ${rc}`,
    });
  }
}

function drainInputRing(budget: number): number {
  if (!instanceExports || !inputHeader || !inputView) {
    return 0;
  }

  const capacity = Atomics.load(inputHeader, INPUT_CAPACITY_INDEX) >>> 0;
  if (capacity === 0) {
    return 0;
  }

  let processed = 0;
  let read = Atomics.load(inputHeader, INPUT_READ_INDEX) >>> 0;

  while (processed < budget) {
    const write = Atomics.load(inputHeader, INPUT_WRITE_INDEX) >>> 0;
    if (read === write) {
      break;
    }

    const slot = read % capacity;
    const offset = slot * INPUT_SLOT_BYTES;
    const eventType = inputView.getUint32(offset + EVENT_TYPE_OFFSET, true);
    const paramA = inputView.getFloat32(offset + EVENT_A_OFFSET, true);
    const paramB = inputView.getFloat32(offset + EVENT_B_OFFSET, true);
    const modifierFlags = inputView.getUint32(offset + EVENT_MOD_OFFSET, true);

    const rc = instanceExports.os_process_input(eventType, paramA, paramB, modifierFlags);
    if (rc < 0) {
      emit({
        type: "OS_FAULT",
        message: `os_process_input failed with code ${rc}`,
      });
      break;
    }

    read = (read + 1) >>> 0;
    processed += 1;
  }

  Atomics.store(inputHeader, INPUT_READ_INDEX, read | 0);
  return processed;
}

async function suspendKernel(): Promise<void> {
  const exportsObject = requireKernel();
  const rc = exportsObject.os_suspend();
  if (rc < 0) {
    throw new Error(`os_suspend failed with code ${rc}`);
  }

  await flushDirtyPages();
  emit({ type: "OS_SUSPENDED" });
}

async function resumeKernel(nextSessionId: string): Promise<void> {
  const exportsObject = requireKernel();
  const payload = await pullSnapshot(nextSessionId);
  if (payload) {
    const restoredPages = applyDeltaPayload(payload);
    emit({
      type: "TELEMETRY",
      message: `[SYNC] restored ${restoredPages} pages from remote snapshot`,
    });
  }

  const sessionLen = writeSession(nextSessionId);
  const rc = exportsObject.os_resume(sessionPtr, sessionLen);
  if (rc < 0) {
    throw new Error(`os_resume failed with code ${rc}`);
  }

  emit({ type: "OS_RESUMED" });
}

async function initKernel(payload?: InitPayload): Promise<void> {
  if (initialized) {
    return;
  }

  bindSharedBuffers(payload);
  sessionId = payload?.sessionId ?? sessionId;

  wasmMemory = new WebAssembly.Memory({
    initial: payload?.initialPages ?? 4096,
    maximum: payload?.maximumPages ?? 32768,
    shared: true,
  });

  const imports: WebAssembly.Imports = {
    env: {
      memory: wasmMemory,
    },
    "host-sync": {
      host_sync: (deltaPtr: number, length: number): number => {
        if (!wasmMemory || length <= 0) {
          return 0;
        }

        const source = new Uint8Array(wasmMemory.buffer, deltaPtr, length);
        const bytes = new Uint8Array(length);
        bytes.set(source);
        void pushSnapshot(bytes, "manifest")
          .then(() => {
            emit({
              type: "TELEMETRY",
              message: `[SYNC] manifest pushed (${length} bytes)`,
            });
          })
          .catch((error: unknown) => {
            emit({
              type: "OS_FAULT",
              message: error instanceof Error ? error.message : "Manifest push failed",
            });
          });
        return 0;
      },
      host_log: (msgPtr: number, msgLen: number): void => {
        emit({
          type: "TELEMETRY",
          message: `[KERNEL] ${readUtf8(msgPtr, msgLen)}`,
        });
      },
    },
  };

  const wasmUrl = payload?.wasmUrl ?? "/wasm/core-os.wasm";
  const response = await fetch(wasmUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Kernel binary fetch failed (${response.status})`);
  }

  const wasmBytes = await response.arrayBuffer();
  const instantiated = await WebAssembly.instantiate(wasmBytes, imports);
  instanceExports = instantiated.instance.exports as unknown as CoreOsExports;

  if (instanceExports.memory instanceof WebAssembly.Memory) {
    wasmMemory = instanceExports.memory;
  }

  allocScratchBuffers(instanceExports);

  const bootCode = instanceExports.os_boot(wasmMemory.buffer.byteLength, payload?.flags ?? 0);
  if (bootCode !== 0) {
    throw new Error(`os_boot failed with code ${bootCode}`);
  }

  await resumeKernel(sessionId);

  kernelLoopId = workerScope.setInterval(() => {
    try {
      const processed = drainInputRing(INPUT_DRAIN_BUDGET);
      if (processed > 0 && inputHeader) {
        Atomics.add(inputHeader, INPUT_SEQUENCE_INDEX, processed);
      }

      pollKernel();
      copyRenderTreeToShared();
    } catch (error: unknown) {
      emit({
        type: "OS_FAULT",
        message: error instanceof Error ? error.message : "Kernel loop failure",
      });
    }
  }, 8);

  deltaLoopId = workerScope.setInterval(() => {
    void flushDirtyPages().catch((error: unknown) => {
      emit({
        type: "OS_FAULT",
        message: error instanceof Error ? error.message : "Delta push loop failed",
      });
    });
  }, 20);

  telemetryLoopId = workerScope.setInterval(() => {
    if (!inputHeader) {
      return;
    }

    const backlog = ringBacklog(inputHeader);
    const dropped = Atomics.load(inputHeader, INPUT_DROPPED_INDEX);
    if (backlog > 0 || dropped > 0) {
      emit({
        type: "TELEMETRY",
        message: `[INPUT] backlog=${backlog} dropped=${dropped}`,
      });
    }
  }, 1000);

  initialized = true;
  emit({
    type: "OS_READY",
    memoryBytes: wasmMemory.buffer.byteLength,
    sessionId,
  });
}

function pollKernel(deadlineNs?: number): void {
  if (!instanceExports) {
    return;
  }

  const deadline = deadlineNs ?? Number(nowNs() + 2_000_000n);
  const rc = instanceExports.os_poll(BigInt(Math.floor(deadline)));
  if (rc < 0) {
    emit({
      type: "OS_FAULT",
      message: `os_poll failed with code ${rc}`,
    });
  }
}

function shutdownKernel(): void {
  if (kernelLoopId !== null) {
    workerScope.clearInterval(kernelLoopId);
    kernelLoopId = null;
  }

  if (deltaLoopId !== null) {
    workerScope.clearInterval(deltaLoopId);
    deltaLoopId = null;
  }

  if (telemetryLoopId !== null) {
    workerScope.clearInterval(telemetryLoopId);
    telemetryLoopId = null;
  }

  if (instanceExports) {
    if (pageIndexPtr) {
      instanceExports.os_free(pageIndexPtr, MAX_DELTA_PAGES * Uint32Array.BYTES_PER_ELEMENT);
    }
    if (pageScratchPtr) {
      instanceExports.os_free(pageScratchPtr, PAGE_SIZE);
    }
    if (renderTreePtr) {
      instanceExports.os_free(renderTreePtr, MAX_RENDER_NODES * WINDOW_NODE_STRIDE);
    }
    if (sessionPtr) {
      instanceExports.os_free(sessionPtr, SESSION_BUFFER_BYTES);
    }
  }

  instanceExports = null;
  wasmMemory = null;
  initialized = false;
  pageIndexPtr = 0;
  pageScratchPtr = 0;
  renderTreePtr = 0;
  sessionPtr = 0;
  inputHeader = null;
  inputView = null;
  renderHeader = null;
  renderBytes = null;
}

workerScope.onmessage = (event: MessageEvent<UiToWorker>) => {
  const message = event.data;

  if (message.type === "INIT_OS") {
    initKernel(message.payload).catch((error: unknown) => {
      emit({
        type: "OS_FAULT",
        message: error instanceof Error ? error.message : "Kernel initialization failed",
      });
    });
    return;
  }

  if (message.type === "POLL") {
    pollKernel(message.payload?.deadlineNs);
    return;
  }

  if (message.type === "PUSH_INPUT") {
    processInputFallback(message.payload);
    return;
  }

  if (message.type === "SUSPEND_OS") {
    suspendKernel().catch((error: unknown) => {
      emit({
        type: "OS_FAULT",
        message: error instanceof Error ? error.message : "Suspend failed",
      });
    });
    return;
  }

  if (message.type === "RESUME_OS") {
    const nextSession = message.payload?.sessionId ?? sessionId;
    sessionId = nextSession;
    resumeKernel(nextSession).catch((error: unknown) => {
      emit({
        type: "OS_FAULT",
        message: error instanceof Error ? error.message : "Resume failed",
      });
    });
    return;
  }

  shutdownKernel();
  workerScope.close();
};
