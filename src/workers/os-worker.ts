/// <reference lib="webworker" />

export {};

type BootMessage = {
  type: "boot";
  wasmUrl?: string;
  initialPages?: number;
  maximumPages?: number;
  ringPages?: number;
};

type PollMessage = {
  type: "poll";
  deadlineNs: bigint;
};

type ShutdownMessage = {
  type: "shutdown";
};

type UiToWorker = BootMessage | PollMessage | ShutdownMessage;

type WorkerToUi =
  | {
      type: "booted";
      memoryBytes: number;
      ringOffset: number;
      ringLength: number;
    }
  | {
      type: "telemetry";
      eventCode: number;
      arg0: number;
      arg1: number;
      timestampNs: bigint;
    }
  | {
      type: "fault";
      message: string;
    };

interface KernelExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  kernel_boot: (
    memoryBytes: number,
    ringOffset: number,
    ringLength: number,
    flags: number,
  ) => number;
  kernel_poll: (deadlineNs: bigint) => number;
  kernel_mount_component: (fd: number, pathPtr: number, pathLen: number) => number;
}

class OpfsBlockStore {
  private readonly rootDirPromise: Promise<FileSystemDirectoryHandle>;
  private readonly handles = new Map<number, FileSystemSyncAccessHandle>();
  private nextFd = 4;

  constructor() {
    const nav = self.navigator as WorkerNavigator & {
      storage: StorageManager;
    };
    this.rootDirPromise = nav.storage.getDirectory();
  }

  async ensureDisk(filename: string, bytes: number): Promise<number> {
    const root = await this.rootDirPromise;
    const fileHandle = await root.getFileHandle(filename, { create: true });
    const accessHandle = await fileHandle.createSyncAccessHandle();

    if (accessHandle.getSize() < bytes) {
      accessHandle.truncate(bytes);
      accessHandle.flush();
    }

    const fd = this.nextFd++;
    this.handles.set(fd, accessHandle);
    return fd;
  }

  readAt(
    fd: number,
    offset: bigint,
    dstPtr: number,
    len: number,
    memory: WebAssembly.Memory,
  ): number {
    const handle = this.handles.get(fd);
    if (!handle) {
      return -9;
    }

    const at = Number(offset);
    if (!Number.isFinite(at) || at < 0) {
      return -22;
    }

    const view = new Uint8Array(memory.buffer, dstPtr, len);
    return handle.read(view, { at });
  }

  writeAt(
    fd: number,
    offset: bigint,
    srcPtr: number,
    len: number,
    memory: WebAssembly.Memory,
  ): number {
    const handle = this.handles.get(fd);
    if (!handle) {
      return -9;
    }

    const at = Number(offset);
    if (!Number.isFinite(at) || at < 0) {
      return -22;
    }

    const view = new Uint8Array(memory.buffer, srcPtr, len);
    const written = handle.write(view, { at });
    handle.flush();
    return written;
  }

  closeAll(): void {
    for (const handle of this.handles.values()) {
      handle.close();
    }
    this.handles.clear();
  }
}

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const opfs = new OpfsBlockStore();

let wasmMemory: WebAssembly.Memory | null = null;
let kernel: KernelExports | null = null;
let diskFd = 0;
let pollActive = false;

function monotonicTimeNs(): bigint {
  return BigInt(Math.floor((performance.timeOrigin + performance.now()) * 1_000_000));
}

function emit(message: WorkerToUi): void {
  workerScope.postMessage(message);
}

async function bootKernel(message: BootMessage): Promise<void> {
  if (kernel !== null) {
    return;
  }

  const wasmUrl = message.wasmUrl ?? "/wasm/os-kernel.wasm";
  const response = await fetch(wasmUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch bootloader WASM (${response.status})`);
  }

  const initialPages = message.initialPages ?? 2048;
  const maximumPages = message.maximumPages ?? 8192;
  wasmMemory = new WebAssembly.Memory({
    initial: initialPages,
    maximum: maximumPages,
    shared: true,
  });

  diskFd = await opfs.ensureDisk("disk0.img", 512 * 1024 * 1024);

  const imports: WebAssembly.Imports = {
    env: {
      memory: wasmMemory,
    },
    host: {
      host_event_notify: (eventCode: number, arg0: number, arg1: number): number => {
        emit({
          type: "telemetry",
          eventCode,
          arg0,
          arg1,
          timestampNs: monotonicTimeNs(),
        });
        return 0;
      },
      host_storage_read: (fd: number, offset: bigint, dstPtr: number, len: number): number => {
        if (wasmMemory === null) {
          return -5;
        }
        return opfs.readAt(fd, offset, dstPtr, len, wasmMemory);
      },
      host_storage_write: (fd: number, offset: bigint, srcPtr: number, len: number): number => {
        if (wasmMemory === null) {
          return -5;
        }
        return opfs.writeAt(fd, offset, srcPtr, len, wasmMemory);
      },
      host_gpu_submit: (_queue: number, _cmdPtr: number, _cmdLen: number): number => {
        return 0;
      },
      host_clock_time_ns: (): bigint => {
        return monotonicTimeNs();
      },
    },
  };

  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, imports);
  kernel = result.instance.exports as unknown as KernelExports;

  if (typeof kernel.kernel_boot !== "function") {
    throw new Error("Export kernel_boot was not found");
  }

  if (typeof kernel.kernel_poll !== "function") {
    throw new Error("Export kernel_poll was not found");
  }

  if (kernel.memory instanceof WebAssembly.Memory) {
    wasmMemory = kernel.memory;
  }

  const ringOffset = 64 * 1024;
  const ringLength = (message.ringPages ?? 16) * 64 * 1024;
  const bootResult = kernel.kernel_boot(wasmMemory.buffer.byteLength, ringOffset, ringLength, diskFd);
  if (bootResult !== 0) {
    throw new Error(`kernel_boot failed with code ${bootResult}`);
  }

  emit({
    type: "booted",
    memoryBytes: wasmMemory.buffer.byteLength,
    ringOffset,
    ringLength,
  });
}

function pollKernel(deadlineNs: bigint): void {
  if (kernel === null || pollActive) {
    return;
  }

  pollActive = true;
  try {
    const code = kernel.kernel_poll(deadlineNs);
    if (code !== 0) {
      emit({
        type: "fault",
        message: `kernel_poll returned ${code}`,
      });
    }
  } finally {
    pollActive = false;
  }
}

function shutdownKernel(): void {
  opfs.closeAll();
  kernel = null;
  wasmMemory = null;
  diskFd = 0;
}

workerScope.onmessage = (event: MessageEvent<UiToWorker>) => {
  const message = event.data;

  if (message.type === "boot") {
    bootKernel(message).catch((error: unknown) => {
      emit({
        type: "fault",
        message: error instanceof Error ? error.message : "Unknown boot error",
      });
    });
    return;
  }

  if (message.type === "poll") {
    pollKernel(message.deadlineNs);
    return;
  }

  shutdownKernel();
  workerScope.close();
};
