import {
  HAL_AUDIO_BLOCK_BYTES,
  HAL_AUDIO_BLOCK_OFFSET,
  HAL_AUDIO_SEQUENCE_INDEX,
  HAL_CAMERA_BLOCK_BYTES,
  HAL_CAMERA_BLOCK_OFFSET,
  HAL_CAMERA_SEQUENCE_INDEX,
  HAL_GAMEPAD_BLOCK_BYTES,
  HAL_GAMEPAD_BLOCK_OFFSET,
  HAL_GAMEPAD_SEQUENCE_INDEX,
  HAL_HAPTIC_BLOCK_BYTES,
  HAL_HAPTIC_BLOCK_OFFSET,
  HAL_HAPTICS_SEQUENCE_INDEX,
  HAL_LOCATION_BLOCK_BYTES,
  HAL_LOCATION_BLOCK_OFFSET,
  HAL_LOCATION_SEQUENCE_INDEX,
  HAL_NFC_BLOCK_BYTES,
  HAL_NFC_BLOCK_OFFSET,
  HAL_NFC_SEQUENCE_INDEX,
  HAL_PERIPHERAL_BLOCK_BYTES,
  HAL_PERIPHERAL_BLOCK_OFFSET,
  HAL_PERIPHERAL_SEQUENCE_INDEX,
  HAL_SENSOR_ID_OFFSET,
  HAL_SENSOR_RING_CAPACITY,
  HAL_SENSOR_RING_OFFSET,
  HAL_SENSOR_SEQ_HIGH_OFFSET,
  HAL_SENSOR_SEQ_LOW_OFFSET,
  HAL_SENSOR_SEQUENCE_INDEX,
  HAL_SENSOR_SLOT_BYTES,
  HAL_SENSOR_TS_HIGH_OFFSET,
  HAL_SENSOR_TS_LOW_OFFSET,
  HAL_SENSOR_WRITE_INDEX,
  HAL_SENSOR_X_OFFSET,
  HAL_SENSOR_Y_OFFSET,
  HAL_SENSOR_Z_OFFSET,
  HAL_SERIAL_BLOCK_BYTES,
  HAL_SERIAL_BLOCK_OFFSET,
  HAL_SERIAL_SEQUENCE_INDEX,
  HAL_SEQUENCE_INDEX,
  HAL_XR_BLOCK_BYTES,
  HAL_XR_BLOCK_OFFSET,
  HAL_XR_SEQUENCE_INDEX,
  FILES_ENTRY_COUNT_INDEX,
  FILES_HEADER_INTS,
  FILES_SEQUENCE_INDEX,
  FILES_TEXT_BYTES_OFFSET,
  FILES_TEXT_CAPACITY,
  FILES_TEXT_LEN_INDEX,
  EDITOR_CURSOR_INDEX,
  EDITOR_FLAGS_INDEX,
  EDITOR_HEADER_INTS,
  EDITOR_SEQUENCE_INDEX,
  EDITOR_TEXT_BYTES_OFFSET,
  EDITOR_TEXT_CAPACITY,
  EDITOR_TEXT_LEN_INDEX,
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
  HARDWARE_HAL_HEADER_INTS,
  MAX_RENDER_NODES,
  MEDIA_CAPTURE_SEQUENCE_INDEX,
  MEDIA_HEADER_INTS,
  MEDIA_PCM_HIGH_INDEX,
  MEDIA_PCM_LOW_INDEX,
  MEDIA_SEQUENCE_INDEX,
  MEDIA_STREAM_COUNT_INDEX,
  METRICS_ACTIVE_APPS_INDEX,
  METRICS_COMPACTION_SEQ_INDEX,
  METRICS_DIRTY_PAGES_INDEX,
  METRICS_HEADER_INTS,
  METRICS_LAST_COMPACTED_PAGES_INDEX,
  METRICS_PENDING_INPUT_INDEX,
  METRICS_SEQUENCE_INDEX,
  METRICS_SYNC_STATUS_INDEX,
  METRICS_TICK_HIGH_INDEX,
  METRICS_TICK_LOW_INDEX,
  METRICS_TOTAL_PAGES_INDEX,
  PAGE_SIZE,
  RENDER_HEADER_BYTES,
  RENDER_HEADER_INTS,
  RENDER_NODE_COUNT_INDEX,
  RENDER_SEQUENCE_INDEX,
  TERMINAL_COLS_INDEX,
  TERMINAL_CURSOR_X_INDEX,
  TERMINAL_CURSOR_Y_INDEX,
  TERMINAL_HEADER_INTS,
  TERMINAL_ROWS_INDEX,
  TERMINAL_SEQUENCE_INDEX,
  TERMINAL_TEXT_BYTES_OFFSET,
  TERMINAL_TEXT_CAPACITY,
  TERMINAL_TEXT_LEN_INDEX,
  WINDOW_NODE_STRIDE,
  ringBacklog,
} from "@/lib/spatialShared";

type InitPayload = {
  sessionId: string;
  wasmUrl: string;
  initialPages: number;
  maximumPages: number;
  flags: number;
  inputRingBuffer: SharedArrayBuffer;
  renderTreeBuffer: SharedArrayBuffer;
  metricsBuffer?: SharedArrayBuffer;
  terminalBuffer?: SharedArrayBuffer;
  editorBuffer?: SharedArrayBuffer;
  mediaBuffer?: SharedArrayBuffer;
  fileExplorerBuffer?: SharedArrayBuffer;
  hardwareHalBuffer?: SharedArrayBuffer;
};

type UiToWorker =
  | {
      type: "INIT_OS";
      payload: InitPayload;
    }
  | {
      type: "SUSPEND_OS";
    }
  | {
      type: "RESUME_OS";
      sessionId?: string;
    }
  | {
      type: "REQUEST_CHECKPOINT";
    }
  | {
      type: "LOAD_COMPONENT";
      kind: number;
      path?: string;
    }
  | {
      type: "INSTALL_APK";
      vfsPath: string;
    }
  | {
      type: "START_ANDROID_ACTIVITY";
      action: string;
      categories: string[];
      dataUri: string;
      packageName: string;
      className: string;
    }
  | {
      type: "CLEAR_SESSION_CACHE";
      sessionId?: string;
    }
  | {
      type: "PUSH_INPUT";
      eventType: number;
      paramA: number;
      paramB: number;
      modifierFlags: number;
    }
  | {
      type: "SHUTDOWN";
    };

type AppDescriptor = {
  appId: number;
  windowId: number;
  kind: number;
  status: number;
  arenaOffset: number;
  arenaLen: number;
};

type WorkerToUi =
  | {
      type: "OS_READY";
      memoryBytes: number;
      sessionId: string;
    }
  | {
      type: "DELTA_PUSHED";
      bytes: number;
      pages: number;
      sequence: number;
      kind: string;
    }
  | {
      type: "SYSTEM_METRICS";
      tick: bigint;
      totalPages: number;
      dirtyPages: number;
      activeApps: number;
      pendingInput: number;
      compactionSequence: number;
      compactedPages: number;
    }
  | {
      type: "APP_LIST";
      apps: AppDescriptor[];
    }
  | {
      type: "APP_LOADED";
      appId: number;
      kind: number;
    }
  | {
      type: "APK_DEPLOYED";
      packageName: string;
      mountPath: string;
      installedCount: number;
    }
  | {
      type: "ANDROID_ACTIVITY_STARTED";
      appId: number;
      packageName: string;
      className: string;
    }
  | {
      type: "OS_SUSPENDED";
    }
  | {
      type: "OS_RESUMED";
      sessionId: string;
    }
  | {
      type: "TELEMETRY";
      message: string;
    }
  | {
      type: "OS_FAULT";
      message: string;
    };

type CoreOsExports = {
  memory: WebAssembly.Memory;
  os_boot(ramBytes: number, flags: number): number;
  os_poll(deadlineNs: bigint): number;
  os_suspend(): number;
  os_resume(ptr: number, len: number): number;
  os_process_input(eventType: number, paramA: number, paramB: number, modifierFlags: number): number;
  os_get_render_tree(dstPtr: number, capacity: number): number;
  os_compact_dirty(outPtr: number, outLen: number, maxPages: number): number;
  os_read_page(pageIndex: number, dstPtr: number, dstLen: number): number;
  os_write_page(pageIndex: number, srcPtr: number, srcLen: number): number;
  os_load_component(kind: number, pathPtr: number, pathLen: number): number;
  os_list_apps(dstPtr: number, capacity: number): number;
  os_get_metrics(outPtr: number, capacity: number): number;
  os_terminal_snapshot(dstPtr: number, maxLen: number): number;
  os_editor_snapshot(dstPtr: number, maxLen: number): number;
  os_media_snapshot(dstPtr: number, maxLen: number): number;
  os_fs_explorer_snapshot(dstPtr: number, maxLen: number): number;
  activity_launch(appUriPtr: number, appUriLen: number, launchFlags: number): number;
  activity_terminate(appId: number, exitCode: number): number;
  activity_send_intent(targetAppId: number, actionCode: number, payloadPtr: number, payloadLen: number): number;
  window_create(appId: number, layoutFlags: number): number;
  window_attach_buffer(windowId: number, bufferPtr: number, bufferLen: number): number;
  window_set_visuals(windowId: number, opacity: number, blurRadius: number, depthZ: number): number;
  fs_open(pathPtr: number, pathLen: number, modeFlags: number): number;
  fs_read_async(fd: number, offset: bigint, destPtr: number, len: number): number;
  fs_write_async(fd: number, offset: bigint, srcPtr: number, len: number): number;
  media_stream_open(streamType: number, rate: number, channels: number): number;
  media_push_pcm(streamId: number, bufferPtr: number, sampleCount: number): number;
  media_capture_frame(windowId: number): number;
  hal_inject_sensor(sensorId: number, x: number, y: number, z: number, timestampNs: bigint): number;
  hal_inject_location(
    latitude: number,
    longitude: number,
    altitude: number,
    accuracy: number,
    heading: number,
    speed: number,
    timestampNs: bigint,
  ): number;
  hal_inject_audio_frame(
    channels: number,
    sampleRate: number,
    bufferPtr: number,
    bufferLen: number,
    timestampNs: bigint,
  ): number;
  hal_inject_camera_frame(
    width: number,
    height: number,
    pixelFormat: number,
    framePtr: number,
    frameLen: number,
    timestampNs: bigint,
  ): number;
  hal_inject_peripheral_token(
    tokenKind: number,
    tokenPtr: number,
    tokenLen: number,
    timestampNs: bigint,
  ): number;
  hal_inject_nfc(
    recordTypePtr: number,
    recordTypeLen: number,
    mediaTypePtr: number,
    mediaTypeLen: number,
    payloadPtr: number,
    payloadLen: number,
    timestampNs: bigint,
  ): number;
  hal_inject_gamepad(
    index: number,
    buttonsLow: number,
    buttonsHigh: number,
    axesPtr: number,
    axesLen: number,
    timestampNs: bigint,
  ): number;
  hal_inject_serial_read(portId: number, dataPtr: number, dataLen: number, timestampNs: bigint): number;
  hal_inject_xr(
    transformPtr: number,
    transformLen: number,
    handPtr: number,
    handLen: number,
    timestampNs: bigint,
  ): number;
  hal_set_haptics(patternPtr: number, patternLen: number, timestampNs: bigint): number;
  android_deploy_apk(pathPtr: number, pathLen: number): number;
  android_start_activity(intentPtr: number, intentLen: number): number;
  android_vm_tick(appId: number): number;
  os_alloc(len: number): number;
  os_free(ptr: number, len: number): void;
};

const COMPACTION_MAGIC = 0x3144_5043;
const REPLAY_MAGIC = 0x3156_4c52;
const APP_DESCRIPTOR_BYTES = 24;
const APP_LIST_CAPACITY = 64;
const MAX_INPUT_BATCH = 512;
const MAX_COMPACTION_PAGES = 256;
const COMPACTION_BUFFER_BYTES = 6 * 1024 * 1024;
const METRICS_SLOTS = 16;
const TERMINAL_SNAPSHOT_BYTES = TERMINAL_TEXT_BYTES_OFFSET + TERMINAL_TEXT_CAPACITY;
const EDITOR_SNAPSHOT_BYTES = EDITOR_TEXT_BYTES_OFFSET + EDITOR_TEXT_CAPACITY;
const MEDIA_SNAPSHOT_BYTES = 8 * 1024;
const FILE_EXPLORER_SNAPSHOT_BYTES = FILES_TEXT_BYTES_OFFSET + FILES_TEXT_CAPACITY;
const APP_KIND_ANDROID_RUNTIME = 10;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let exportsRef: CoreOsExports | null = null;
let activeSessionId = "default";
let initInFlight = false;
let kernelSuspended = false;
let snapshotSequence = 1;

let pollTimer: number | null = null;
let compactionTimer: number | null = null;
let metricsTimer: number | null = null;
let appMirrorTimer: number | null = null;
let telemetryTimer: number | null = null;

let inputHeader: Int32Array | null = null;
let inputData: DataView | null = null;
let renderHeader: Int32Array | null = null;
let renderBytes: Uint8Array | null = null;
let metricsHeader: Int32Array | null = null;
let terminalHeader: Int32Array | null = null;
let terminalBytes: Uint8Array | null = null;
let editorHeader: Int32Array | null = null;
let editorBytes: Uint8Array | null = null;
let mediaHeader: Int32Array | null = null;
let fileExplorerHeader: Int32Array | null = null;
let fileExplorerBytes: Uint8Array | null = null;
let hardwareHalHeader: Int32Array | null = null;
let hardwareHalBytes: Uint8Array | null = null;
let hardwareHalData: DataView | null = null;

let renderTreePtr = 0;
let compactionPtr = 0;
let metricsPtr = 0;
let terminalPtr = 0;
let editorPtr = 0;
let mediaPtr = 0;
let fileExplorerPtr = 0;
let pageScratchPtr = 0;
let appListPtr = 0;

let runtimeApps: AppDescriptor[] = [];
let androidTickCursor = 0;

let geoWatchId: number | null = null;
let gamepadPollTimer: number | null = null;
let xrPollTimer: number | null = null;
let mediaPollTimer: number | null = null;
let peripheralPollTimer: number | null = null;
let sensorCleanupFns: Array<() => void> = [];
let serialReaderCancels: Array<() => void> = [];

function post(message: WorkerToUi): void {
  self.postMessage(message);
}

function markSyncStatus(status: number): void {
  if (!metricsHeader) {
    return;
  }

  Atomics.store(metricsHeader, METRICS_SYNC_STATUS_INDEX, status | 0);
}

function nextSnapshotSequence(preferred?: number): number {
  if (typeof preferred === "number" && Number.isFinite(preferred) && preferred > 0) {
    snapshotSequence = Math.max(snapshotSequence, preferred + 1);
    return preferred;
  }

  const sequence = snapshotSequence;
  snapshotSequence += 1;
  return sequence;
}

function wasmBytes(): Uint8Array {
  if (!exportsRef) {
    return new Uint8Array(0);
  }

  return new Uint8Array(exportsRef.memory.buffer);
}

function bindSharedBuffers(payload: InitPayload): void {
  inputHeader = new Int32Array(payload.inputRingBuffer, 0, INPUT_HEADER_INTS);
  inputData = new DataView(payload.inputRingBuffer, INPUT_HEADER_BYTES);

  renderHeader = new Int32Array(payload.renderTreeBuffer, 0, RENDER_HEADER_INTS);
  renderBytes = new Uint8Array(payload.renderTreeBuffer, RENDER_HEADER_BYTES);

  metricsHeader = payload.metricsBuffer
    ? new Int32Array(payload.metricsBuffer, 0, METRICS_HEADER_INTS)
    : null;

  if (payload.terminalBuffer) {
    terminalHeader = new Int32Array(payload.terminalBuffer, 0, TERMINAL_HEADER_INTS);
    terminalBytes = new Uint8Array(payload.terminalBuffer, TERMINAL_TEXT_BYTES_OFFSET);
  } else {
    terminalHeader = null;
    terminalBytes = null;
  }

  if (payload.editorBuffer) {
    editorHeader = new Int32Array(payload.editorBuffer, 0, EDITOR_HEADER_INTS);
    editorBytes = new Uint8Array(payload.editorBuffer, EDITOR_TEXT_BYTES_OFFSET);
  } else {
    editorHeader = null;
    editorBytes = null;
  }

  if (payload.mediaBuffer) {
    mediaHeader = new Int32Array(payload.mediaBuffer, 0, MEDIA_HEADER_INTS);
  } else {
    mediaHeader = null;
  }

  if (payload.fileExplorerBuffer) {
    fileExplorerHeader = new Int32Array(payload.fileExplorerBuffer, 0, FILES_HEADER_INTS);
    fileExplorerBytes = new Uint8Array(payload.fileExplorerBuffer, FILES_TEXT_BYTES_OFFSET);
  } else {
    fileExplorerHeader = null;
    fileExplorerBytes = null;
  }

  if (payload.hardwareHalBuffer) {
    hardwareHalHeader = new Int32Array(payload.hardwareHalBuffer, 0, HARDWARE_HAL_HEADER_INTS);
    hardwareHalBytes = new Uint8Array(payload.hardwareHalBuffer, HARDWARE_HAL_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT);
    hardwareHalData = new DataView(payload.hardwareHalBuffer, 0);
  } else {
    hardwareHalHeader = null;
    hardwareHalBytes = null;
    hardwareHalData = null;
  }
}

function clearTimers(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (compactionTimer !== null) {
    clearInterval(compactionTimer);
    compactionTimer = null;
  }

  if (metricsTimer !== null) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }

  if (appMirrorTimer !== null) {
    clearInterval(appMirrorTimer);
    appMirrorTimer = null;
  }

  if (telemetryTimer !== null) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
}

function allocateScratch(): void {
  if (!exportsRef) {
    return;
  }

  renderTreePtr = exportsRef.os_alloc(MAX_RENDER_NODES * WINDOW_NODE_STRIDE);
  compactionPtr = exportsRef.os_alloc(COMPACTION_BUFFER_BYTES);
  metricsPtr = exportsRef.os_alloc(METRICS_SLOTS * Uint32Array.BYTES_PER_ELEMENT);
  terminalPtr = exportsRef.os_alloc(TERMINAL_SNAPSHOT_BYTES);
  editorPtr = exportsRef.os_alloc(EDITOR_SNAPSHOT_BYTES);
  mediaPtr = exportsRef.os_alloc(MEDIA_SNAPSHOT_BYTES);
  fileExplorerPtr = exportsRef.os_alloc(FILE_EXPLORER_SNAPSHOT_BYTES);
  pageScratchPtr = exportsRef.os_alloc(PAGE_SIZE);
  appListPtr = exportsRef.os_alloc(APP_LIST_CAPACITY * APP_DESCRIPTOR_BYTES);
}

function releaseScratch(): void {
  if (!exportsRef) {
    renderTreePtr = 0;
    compactionPtr = 0;
    metricsPtr = 0;
    terminalPtr = 0;
    editorPtr = 0;
    mediaPtr = 0;
    fileExplorerPtr = 0;
    pageScratchPtr = 0;
    appListPtr = 0;
    return;
  }

  if (renderTreePtr > 0) {
    exportsRef.os_free(renderTreePtr, MAX_RENDER_NODES * WINDOW_NODE_STRIDE);
    renderTreePtr = 0;
  }

  if (compactionPtr > 0) {
    exportsRef.os_free(compactionPtr, COMPACTION_BUFFER_BYTES);
    compactionPtr = 0;
  }

  if (metricsPtr > 0) {
    exportsRef.os_free(metricsPtr, METRICS_SLOTS * Uint32Array.BYTES_PER_ELEMENT);
    metricsPtr = 0;
  }

  if (terminalPtr > 0) {
    exportsRef.os_free(terminalPtr, TERMINAL_SNAPSHOT_BYTES);
    terminalPtr = 0;
  }

  if (editorPtr > 0) {
    exportsRef.os_free(editorPtr, EDITOR_SNAPSHOT_BYTES);
    editorPtr = 0;
  }

  if (mediaPtr > 0) {
    exportsRef.os_free(mediaPtr, MEDIA_SNAPSHOT_BYTES);
    mediaPtr = 0;
  }

  if (fileExplorerPtr > 0) {
    exportsRef.os_free(fileExplorerPtr, FILE_EXPLORER_SNAPSHOT_BYTES);
    fileExplorerPtr = 0;
  }

  if (pageScratchPtr > 0) {
    exportsRef.os_free(pageScratchPtr, PAGE_SIZE);
    pageScratchPtr = 0;
  }

  if (appListPtr > 0) {
    exportsRef.os_free(appListPtr, APP_LIST_CAPACITY * APP_DESCRIPTOR_BYTES);
    appListPtr = 0;
  }
}

function writeUtf8(text: string): { ptr: number; len: number } | null {
  if (!exportsRef) {
    return null;
  }

  const encoded = textEncoder.encode(text);
  if (encoded.byteLength === 0) {
    return { ptr: 0, len: 0 };
  }

  const ptr = exportsRef.os_alloc(encoded.byteLength);
  if (ptr === 0) {
    return null;
  }

  wasmBytes().set(encoded, ptr);
  return { ptr, len: encoded.byteLength };
}

function freeUtf8(handle: { ptr: number; len: number } | null): void {
  if (!exportsRef || !handle || handle.ptr === 0 || handle.len === 0) {
    return;
  }

  exportsRef.os_free(handle.ptr, handle.len);
}

function nowNs(): bigint {
  return BigInt(Math.floor((performance.timeOrigin + performance.now()) * 1_000_000));
}

function splitU64(value: bigint): { low: number; high: number } {
  return {
    low: Number(value & 0xffff_ffffn),
    high: Number((value >> 32n) & 0xffff_ffffn),
  };
}

function writeBytes(bytes: Uint8Array): { ptr: number; len: number } | null {
  if (!exportsRef || bytes.byteLength === 0) {
    return null;
  }

  const ptr = exportsRef.os_alloc(bytes.byteLength);
  if (ptr === 0) {
    return null;
  }

  wasmBytes().set(bytes, ptr);
  return { ptr, len: bytes.byteLength };
}

function freeBytes(handle: { ptr: number; len: number } | null): void {
  if (!exportsRef || !handle || handle.ptr === 0 || handle.len === 0) {
    return;
  }

  exportsRef.os_free(handle.ptr, handle.len);
}

function encodeF32List(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i += 1) {
    view.setFloat32(i * 4, Math.fround(values[i] ?? 0), true);
  }
  return bytes;
}

function encodeU32List(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i += 1) {
    view.setUint32(i * 4, (values[i] ?? 0) >>> 0, true);
  }
  return bytes;
}

function bumpHalSequence(index: number): number {
  if (!hardwareHalHeader) {
    return 0;
  }

  const seq = (Atomics.add(hardwareHalHeader, index, 1) + 1) >>> 0;
  Atomics.add(hardwareHalHeader, HAL_SEQUENCE_INDEX, 1);
  return seq;
}

function writeHalBlock(offset: number, maxBytes: number, payload: Uint8Array): void {
  if (!hardwareHalData || maxBytes <= 0) {
    return;
  }

  if (offset < 0 || offset >= hardwareHalData.byteLength) {
    return;
  }

  const safeBytes = Math.min(maxBytes, hardwareHalData.byteLength - offset);
  if (safeBytes <= 0) {
    return;
  }

  const target = new Uint8Array(hardwareHalData.buffer, hardwareHalData.byteOffset + offset, safeBytes);
  target.fill(0);
  target.set(payload.subarray(0, Math.min(payload.byteLength, safeBytes)), 0);
}

function writeSensorToHalBuffer(
  sensorId: number,
  x: number,
  y: number,
  z: number,
  timestampNs: bigint,
): void {
  if (!hardwareHalHeader || !hardwareHalData) {
    return;
  }

  const writeIndex = Atomics.add(hardwareHalHeader, HAL_SENSOR_WRITE_INDEX, 1) >>> 0;
  const slot = writeIndex % HAL_SENSOR_RING_CAPACITY;
  const offset = HAL_SENSOR_RING_OFFSET + slot * HAL_SENSOR_SLOT_BYTES;
  const sequence = bumpHalSequence(HAL_SENSOR_SEQUENCE_INDEX);
  const ts = splitU64(timestampNs);

  hardwareHalData.setUint32(offset + HAL_SENSOR_ID_OFFSET, sensorId >>> 0, true);
  hardwareHalData.setFloat32(offset + HAL_SENSOR_X_OFFSET, Math.fround(x), true);
  hardwareHalData.setFloat32(offset + HAL_SENSOR_Y_OFFSET, Math.fround(y), true);
  hardwareHalData.setFloat32(offset + HAL_SENSOR_Z_OFFSET, Math.fround(z), true);
  hardwareHalData.setUint32(offset + HAL_SENSOR_TS_LOW_OFFSET, ts.low, true);
  hardwareHalData.setUint32(offset + HAL_SENSOR_TS_HIGH_OFFSET, ts.high, true);
  hardwareHalData.setUint32(offset + HAL_SENSOR_SEQ_LOW_OFFSET, sequence >>> 0, true);
  hardwareHalData.setUint32(offset + HAL_SENSOR_SEQ_HIGH_OFFSET, 0, true);
}

function writeLocationToHalBuffer(
  latitude: number,
  longitude: number,
  altitude: number,
  accuracy: number,
  heading: number,
  speed: number,
  timestampNs: bigint,
): void {
  const sequence = bumpHalSequence(HAL_LOCATION_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_LOCATION_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);

  view.setFloat64(0, latitude, true);
  view.setFloat64(8, longitude, true);
  view.setFloat64(16, altitude, true);
  view.setFloat32(24, Math.fround(accuracy), true);
  view.setFloat32(28, Math.fround(heading), true);
  view.setFloat32(32, Math.fround(speed), true);
  view.setUint32(36, ts.low, true);
  view.setUint32(40, ts.high, true);
  view.setUint32(44, sequence >>> 0, true);
  writeHalBlock(HAL_LOCATION_BLOCK_OFFSET, HAL_LOCATION_BLOCK_BYTES, packet);
}

function writeAudioToHalBuffer(
  channels: number,
  sampleRate: number,
  pcm: Uint8Array,
  timestampNs: bigint,
): void {
  const sequence = bumpHalSequence(HAL_AUDIO_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_AUDIO_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const copyLen = Math.min(pcm.byteLength, Math.max(0, HAL_AUDIO_BLOCK_BYTES - 32));

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, channels >>> 0, true);
  view.setUint32(20, sampleRate >>> 0, true);
  view.setUint32(24, copyLen >>> 0, true);
  if (copyLen > 0) {
    packet.set(pcm.subarray(0, copyLen), 32);
  }

  writeHalBlock(HAL_AUDIO_BLOCK_OFFSET, HAL_AUDIO_BLOCK_BYTES, packet);
}

function writeCameraToHalBuffer(
  width: number,
  height: number,
  pixelFormat: number,
  frame: Uint8Array,
  timestampNs: bigint,
): void {
  const sequence = bumpHalSequence(HAL_CAMERA_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_CAMERA_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const copyLen = Math.min(frame.byteLength, Math.max(0, HAL_CAMERA_BLOCK_BYTES - 40));

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, width >>> 0, true);
  view.setUint32(20, height >>> 0, true);
  view.setUint32(24, pixelFormat >>> 0, true);
  view.setUint32(28, copyLen >>> 0, true);
  if (copyLen > 0) {
    packet.set(frame.subarray(0, copyLen), 40);
  }

  writeHalBlock(HAL_CAMERA_BLOCK_OFFSET, HAL_CAMERA_BLOCK_BYTES, packet);
}

function writePeripheralToHalBuffer(tokenKind: number, token: Uint8Array, timestampNs: bigint): void {
  const sequence = bumpHalSequence(HAL_PERIPHERAL_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_PERIPHERAL_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const copyLen = Math.min(token.byteLength, Math.max(0, HAL_PERIPHERAL_BLOCK_BYTES - 32));

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, tokenKind >>> 0, true);
  view.setUint32(20, copyLen >>> 0, true);
  if (copyLen > 0) {
    packet.set(token.subarray(0, copyLen), 32);
  }

  writeHalBlock(HAL_PERIPHERAL_BLOCK_OFFSET, HAL_PERIPHERAL_BLOCK_BYTES, packet);
}

function writeNfcToHalBuffer(
  recordType: string,
  mediaType: string,
  payload: Uint8Array,
  timestampNs: bigint,
): void {
  const sequence = bumpHalSequence(HAL_NFC_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_NFC_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const recordBytes = textEncoder.encode(recordType);
  const mediaBytes = textEncoder.encode(mediaType);

  const head = 24;
  const maxPayload = Math.max(0, HAL_NFC_BLOCK_BYTES - head);
  const recordLen = Math.min(recordBytes.byteLength, Math.min(128, maxPayload));
  const mediaLen = Math.min(mediaBytes.byteLength, Math.min(128, Math.max(0, maxPayload - recordLen)));
  const dataLen = Math.min(payload.byteLength, Math.max(0, maxPayload - recordLen - mediaLen));

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint16(16, recordLen, true);
  view.setUint16(18, mediaLen, true);
  view.setUint32(20, dataLen, true);

  packet.set(recordBytes.subarray(0, recordLen), head);
  packet.set(mediaBytes.subarray(0, mediaLen), head + recordLen);
  packet.set(payload.subarray(0, dataLen), head + recordLen + mediaLen);
  writeHalBlock(HAL_NFC_BLOCK_OFFSET, HAL_NFC_BLOCK_BYTES, packet);
}

function writeGamepadToHalBuffer(
  index: number,
  buttonsLow: number,
  buttonsHigh: number,
  axes: number[],
  timestampNs: bigint,
): void {
  const sequence = bumpHalSequence(HAL_GAMEPAD_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_GAMEPAD_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const axisCount = Math.min(axes.length, 16);

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, index >>> 0, true);
  view.setUint32(20, buttonsLow >>> 0, true);
  view.setUint32(24, buttonsHigh >>> 0, true);
  view.setUint32(28, axisCount >>> 0, true);

  for (let i = 0; i < axisCount; i += 1) {
    view.setFloat32(32 + i * 4, Math.fround(axes[i] ?? 0), true);
  }

  writeHalBlock(HAL_GAMEPAD_BLOCK_OFFSET, HAL_GAMEPAD_BLOCK_BYTES, packet);
}

function writeSerialToHalBuffer(portId: number, data: Uint8Array, timestampNs: bigint): void {
  const sequence = bumpHalSequence(HAL_SERIAL_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_SERIAL_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const copyLen = Math.min(data.byteLength, Math.max(0, HAL_SERIAL_BLOCK_BYTES - 32));

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, portId >>> 0, true);
  view.setUint32(20, copyLen >>> 0, true);
  if (copyLen > 0) {
    packet.set(data.subarray(0, copyLen), 32);
  }

  writeHalBlock(HAL_SERIAL_BLOCK_OFFSET, HAL_SERIAL_BLOCK_BYTES, packet);
}

function writeXrToHalBuffer(transform: number[], handTracking: number[], timestampNs: bigint): void {
  const sequence = bumpHalSequence(HAL_XR_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_XR_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const transformCount = Math.min(transform.length, 16);
  const handCount = Math.min(handTracking.length, 32);

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, transformCount >>> 0, true);
  view.setUint32(20, handCount >>> 0, true);

  for (let i = 0; i < transformCount; i += 1) {
    view.setFloat32(24 + i * 4, Math.fround(transform[i] ?? 0), true);
  }

  const handBase = 24 + 16 * 4;
  for (let i = 0; i < handCount; i += 1) {
    view.setFloat32(handBase + i * 4, Math.fround(handTracking[i] ?? 0), true);
  }

  writeHalBlock(HAL_XR_BLOCK_OFFSET, HAL_XR_BLOCK_BYTES, packet);
}

function writeHapticsToHalBuffer(patternMs: number[], timestampNs: bigint): void {
  const sequence = bumpHalSequence(HAL_HAPTICS_SEQUENCE_INDEX);
  const packet = new Uint8Array(HAL_HAPTIC_BLOCK_BYTES);
  const view = new DataView(packet.buffer);
  const ts = splitU64(timestampNs);
  const patternLen = Math.min(patternMs.length, 16);

  view.setUint32(0, sequence >>> 0, true);
  view.setUint32(8, ts.low, true);
  view.setUint32(12, ts.high, true);
  view.setUint32(16, patternLen >>> 0, true);
  for (let i = 0; i < patternLen; i += 1) {
    view.setUint32(20 + i * 4, (patternMs[i] ?? 0) >>> 0, true);
  }

  writeHalBlock(HAL_HAPTIC_BLOCK_OFFSET, HAL_HAPTIC_BLOCK_BYTES, packet);
}

function injectSensor(sensorId: number, x: number, y: number, z: number, timestampNs = nowNs()): void {
  if (!exportsRef) {
    return;
  }

  const rc = exportsRef.hal_inject_sensor(sensorId, Math.fround(x), Math.fround(y), Math.fround(z), timestampNs);
  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:SENSOR] inject failed sensor=${sensorId} rc=${rc}` });
    return;
  }

  writeSensorToHalBuffer(sensorId, x, y, z, timestampNs);
}

function injectLocation(
  latitude: number,
  longitude: number,
  altitude: number,
  accuracy: number,
  heading: number,
  speed: number,
  timestampNs = nowNs(),
): void {
  if (!exportsRef) {
    return;
  }

  const rc = exportsRef.hal_inject_location(
    latitude,
    longitude,
    altitude,
    Math.fround(accuracy),
    Math.fround(heading),
    Math.fround(speed),
    timestampNs,
  );

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:GPS] inject failed rc=${rc}` });
    return;
  }

  writeLocationToHalBuffer(latitude, longitude, altitude, accuracy, heading, speed, timestampNs);
}

function injectAudioFrame(channels: number, sampleRate: number, pcm: Uint8Array, timestampNs = nowNs()): void {
  if (!exportsRef) {
    return;
  }

  const handle = writeBytes(pcm);
  const rc = exportsRef.hal_inject_audio_frame(
    channels | 0,
    sampleRate | 0,
    handle?.ptr ?? 0,
    handle?.len ?? 0,
    timestampNs,
  );
  freeBytes(handle);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:AUDIO] inject failed rc=${rc}` });
    return;
  }

  writeAudioToHalBuffer(channels, sampleRate, pcm, timestampNs);
}

function injectCameraFrame(
  width: number,
  height: number,
  pixelFormat: number,
  frame: Uint8Array,
  timestampNs = nowNs(),
): void {
  if (!exportsRef) {
    return;
  }

  const handle = writeBytes(frame);
  const rc = exportsRef.hal_inject_camera_frame(
    width | 0,
    height | 0,
    pixelFormat | 0,
    handle?.ptr ?? 0,
    handle?.len ?? 0,
    timestampNs,
  );
  freeBytes(handle);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:CAM] inject failed rc=${rc}` });
    return;
  }

  writeCameraToHalBuffer(width, height, pixelFormat, frame, timestampNs);
}

function injectPeripheralToken(tokenKind: number, token: Uint8Array, timestampNs = nowNs()): void {
  if (!exportsRef) {
    return;
  }

  const handle = writeBytes(token);
  const rc = exportsRef.hal_inject_peripheral_token(tokenKind | 0, handle?.ptr ?? 0, handle?.len ?? 0, timestampNs);
  freeBytes(handle);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:PERIPH] inject failed rc=${rc}` });
    return;
  }

  writePeripheralToHalBuffer(tokenKind, token, timestampNs);
}

function injectNfc(
  recordType: string,
  mediaType: string,
  payload: Uint8Array,
  timestampNs = nowNs(),
): void {
  if (!exportsRef) {
    return;
  }

  const record = writeUtf8(recordType);
  const media = writeUtf8(mediaType);
  const data = writeBytes(payload);

  const rc = exportsRef.hal_inject_nfc(
    record?.ptr ?? 0,
    record?.len ?? 0,
    media?.ptr ?? 0,
    media?.len ?? 0,
    data?.ptr ?? 0,
    data?.len ?? 0,
    timestampNs,
  );

  freeUtf8(record);
  freeUtf8(media);
  freeBytes(data);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:NFC] inject failed rc=${rc}` });
    return;
  }

  writeNfcToHalBuffer(recordType, mediaType, payload, timestampNs);
}

function injectGamepad(
  index: number,
  buttonsLow: number,
  buttonsHigh: number,
  axes: number[],
  timestampNs = nowNs(),
): void {
  if (!exportsRef) {
    return;
  }

  const axesBytes = encodeF32List(axes.map((value) => Math.fround(value)));
  const handle = writeBytes(axesBytes);
  const rc = exportsRef.hal_inject_gamepad(
    index | 0,
    buttonsLow >>> 0,
    buttonsHigh >>> 0,
    handle?.ptr ?? 0,
    handle?.len ?? 0,
    timestampNs,
  );
  freeBytes(handle);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:GAMEPAD] inject failed index=${index} rc=${rc}` });
    return;
  }

  writeGamepadToHalBuffer(index, buttonsLow, buttonsHigh, axes, timestampNs);
}

function injectSerialRead(portId: number, data: Uint8Array, timestampNs = nowNs()): void {
  if (!exportsRef) {
    return;
  }

  const handle = writeBytes(data);
  const rc = exportsRef.hal_inject_serial_read(portId | 0, handle?.ptr ?? 0, handle?.len ?? 0, timestampNs);
  freeBytes(handle);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:SERIAL] inject failed port=${portId} rc=${rc}` });
    return;
  }

  writeSerialToHalBuffer(portId, data, timestampNs);
}

function injectXrPose(transform: number[], handTracking: number[], timestampNs = nowNs()): void {
  if (!exportsRef) {
    return;
  }

  const transformBytes = writeBytes(encodeF32List(transform.map((value) => Math.fround(value))));
  const handBytes = writeBytes(encodeF32List(handTracking.map((value) => Math.fround(value))));

  const rc = exportsRef.hal_inject_xr(
    transformBytes?.ptr ?? 0,
    transformBytes?.len ?? 0,
    handBytes?.ptr ?? 0,
    handBytes?.len ?? 0,
    timestampNs,
  );

  freeBytes(transformBytes);
  freeBytes(handBytes);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:XR] inject failed rc=${rc}` });
    return;
  }

  writeXrToHalBuffer(transform, handTracking, timestampNs);
}

function setHapticsPattern(patternMs: number[], timestampNs = nowNs()): void {
  if (!exportsRef) {
    return;
  }

  const handle = writeBytes(encodeU32List(patternMs));
  const rc = exportsRef.hal_set_haptics(handle?.ptr ?? 0, handle?.len ?? 0, timestampNs);
  freeBytes(handle);

  if (rc < 0) {
    post({ type: "TELEMETRY", message: `[HAL:HAPTICS] set failed rc=${rc}` });
    return;
  }

  writeHapticsToHalBuffer(patternMs, timestampNs);
}

function teardownHardwareListeners(): void {
  const nav = (self as unknown as { navigator?: any }).navigator;

  if (geoWatchId !== null && nav?.geolocation?.clearWatch) {
    try {
      nav.geolocation.clearWatch(geoWatchId);
    } catch {
      // Ignore geolocation clear errors during shutdown.
    }
    geoWatchId = null;
  }

  if (gamepadPollTimer !== null) {
    clearInterval(gamepadPollTimer);
    gamepadPollTimer = null;
  }

  if (xrPollTimer !== null) {
    clearInterval(xrPollTimer);
    xrPollTimer = null;
  }

  if (mediaPollTimer !== null) {
    clearInterval(mediaPollTimer);
    mediaPollTimer = null;
  }

  if (peripheralPollTimer !== null) {
    clearInterval(peripheralPollTimer);
    peripheralPollTimer = null;
  }

  for (const cleanup of sensorCleanupFns) {
    try {
      cleanup();
    } catch {
      // Ignore listener cleanup failures.
    }
  }
  sensorCleanupFns = [];

  for (const cancel of serialReaderCancels) {
    try {
      cancel();
    } catch {
      // Ignore serial cancellation failures.
    }
  }
  serialReaderCancels = [];
}

function registerGenericSensor(ctorName: string, sensorId: number, frequency = 120): void {
  const scope = self as unknown as Record<string, any>;
  const SensorCtor = scope[ctorName];
  if (typeof SensorCtor !== "function") {
    return;
  }

  try {
    const sensor = new SensorCtor({ frequency });
    const onReading = () => {
      injectSensor(
        sensorId,
        Number(sensor.x ?? 0),
        Number(sensor.y ?? 0),
        Number(sensor.z ?? 0),
        nowNs(),
      );
    };

    sensor.addEventListener?.("reading", onReading);
    sensor.start?.();

    sensorCleanupFns.push(() => {
      sensor.removeEventListener?.("reading", onReading);
      sensor.stop?.();
    });
  } catch (error) {
    post({
      type: "TELEMETRY",
      message: `[HAL:SENSOR] ${ctorName} unavailable: ${String(error)}`,
    });
  }
}

function initGeolocationListener(): void {
  const nav = (self as unknown as { navigator?: any }).navigator;
  if (!nav?.geolocation?.watchPosition) {
    return;
  }

  try {
    geoWatchId = nav.geolocation.watchPosition(
      (position: any) => {
        injectLocation(
          Number(position?.coords?.latitude ?? 0),
          Number(position?.coords?.longitude ?? 0),
          Number(position?.coords?.altitude ?? 0),
          Number(position?.coords?.accuracy ?? 0),
          Number(position?.coords?.heading ?? 0),
          Number(position?.coords?.speed ?? 0),
          nowNs(),
        );
      },
      (error: any) => {
        post({ type: "TELEMETRY", message: `[HAL:GPS] watch blocked: ${String(error?.message ?? error)}` });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 },
    );
  } catch (error) {
    post({ type: "TELEMETRY", message: `[HAL:GPS] setup failed: ${String(error)}` });
  }
}

function initSensorListeners(): void {
  registerGenericSensor("LinearAccelerationSensor", 0, 200);
  registerGenericSensor("Gyroscope", 1, 200);
  registerGenericSensor("Magnetometer", 2, 100);

  const scope = self as unknown as any;
  if (typeof scope.AbsoluteOrientationSensor === "function") {
    try {
      const orientation = new scope.AbsoluteOrientationSensor({ frequency: 120 });
      const onReading = () => {
        const q = orientation.quaternion as number[] | undefined;
        injectSensor(3, Number(q?.[0] ?? 0), Number(q?.[1] ?? 0), Number(q?.[2] ?? 0), nowNs());
      };

      orientation.addEventListener("reading", onReading);
      orientation.start();

      sensorCleanupFns.push(() => {
        orientation.removeEventListener("reading", onReading);
        orientation.stop();
      });
    } catch (error) {
      post({ type: "TELEMETRY", message: `[HAL:SENSOR] orientation setup failed: ${String(error)}` });
    }
  }
}

function initGamepadPolling(): void {
  const nav = (self as unknown as { navigator?: any }).navigator;
  if (typeof nav?.getGamepads !== "function") {
    return;
  }

  gamepadPollTimer = self.setInterval(() => {
    if (!exportsRef || kernelSuspended) {
      return;
    }

    const pads = nav.getGamepads() as Array<any>;
    if (!pads || pads.length === 0) {
      return;
    }

    const timestampNs = nowNs();
    for (const gp of pads) {
      if (!gp) {
        continue;
      }

      let low = 0;
      let high = 0;
      const buttons = Array.isArray(gp.buttons) ? gp.buttons : [];
      for (let idx = 0; idx < buttons.length && idx < 64; idx += 1) {
        if (!buttons[idx]?.pressed) {
          continue;
        }

        if (idx < 32) {
          low = (low | ((1 << idx) >>> 0)) >>> 0;
        } else {
          high = (high | ((1 << (idx - 32)) >>> 0)) >>> 0;
        }
      }

      const axes = (Array.isArray(gp.axes) ? gp.axes : [])
        .slice(0, 8)
        .map((value: number) => Math.fround(value));
      injectGamepad(Number(gp.index ?? 0), low, high, axes, timestampNs);
    }
  }, 16);
}

async function initNfcListener(): Promise<void> {
  const scope = self as unknown as any;
  if (typeof scope.NDEFReader !== "function") {
    return;
  }

  try {
    const reader = new scope.NDEFReader();
    await reader.scan();

    const onReading = (event: any) => {
      const message = event?.message;
      const records = Array.isArray(message?.records) ? message.records : [];
      const timestampNs = nowNs();

      for (const record of records) {
        const payload = record?.data
          ? new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)
          : new Uint8Array(0);
        injectNfc(
          String(record?.recordType ?? "unknown"),
          String(record?.mediaType ?? "application/octet-stream"),
          payload,
          timestampNs,
        );
      }
    };

    reader.addEventListener("reading", onReading);
    sensorCleanupFns.push(() => {
      reader.removeEventListener("reading", onReading);
    });
  } catch (error) {
    post({ type: "TELEMETRY", message: `[HAL:NFC] scan unavailable: ${String(error)}` });
  }
}

async function pumpSerialPort(port: any, portId: number): Promise<void> {
  let reader: any = null;

  try {
    if (!port.readable && typeof port.open === "function") {
      await port.open({ baudRate: 115200 });
    }

    if (!port.readable?.getReader) {
      return;
    }

    reader = port.readable.getReader();
    let canceled = false;
    serialReaderCancels.push(() => {
      canceled = true;
      void reader.cancel();
    });

    while (!canceled) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        injectSerialRead(portId, bytes, nowNs());
      }
    }
  } catch (error) {
    post({ type: "TELEMETRY", message: `[HAL:SERIAL] port=${portId} read failed: ${String(error)}` });
  } finally {
    try {
      reader?.releaseLock?.();
    } catch {
      // Ignore lock release issues.
    }
  }
}

async function initSerialListeners(): Promise<void> {
  const nav = (self as unknown as { navigator?: any }).navigator;
  if (!nav?.serial?.getPorts) {
    return;
  }

  try {
    const ports = await nav.serial.getPorts();
    for (let i = 0; i < ports.length; i += 1) {
      void pumpSerialPort(ports[i], i);
    }
  } catch (error) {
    post({ type: "TELEMETRY", message: `[HAL:SERIAL] init failed: ${String(error)}` });
  }
}

function initXrPolling(): void {
  const nav = (self as unknown as { navigator?: any }).navigator;
  if (!nav?.xr) {
    return;
  }

  xrPollTimer = self.setInterval(() => {
    if (!exportsRef || kernelSuspended) {
      return;
    }

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    injectXrPose(identity, [], nowNs());
  }, 250);
}

async function initMediaPipelines(): Promise<void> {
  const nav = (self as unknown as { navigator?: any }).navigator;
  if (!nav?.mediaDevices?.getUserMedia) {
    return;
  }

  try {
    const stream = await nav.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
    });

    const videoTrack = stream.getVideoTracks?.()[0] ?? null;
    const audioTrack = stream.getAudioTracks?.()[0] ?? null;
    let pulse = 0;

    mediaPollTimer = self.setInterval(() => {
      if (!exportsRef || kernelSuspended) {
        return;
      }

      const timestampNs = nowNs();

      if (videoTrack) {
        const settings = videoTrack.getSettings?.() ?? {};
        const width = Number(settings.width ?? 640);
        const height = Number(settings.height ?? 360);
        const frame = new Uint8Array(256);
        frame.fill(pulse & 0xff);
        injectCameraFrame(width, height, 1, frame, timestampNs);
      }

      if (audioTrack) {
        const settings = audioTrack.getSettings?.() ?? {};
        const channels = Number(settings.channelCount ?? 1);
        const sampleRate = Number(settings.sampleRate ?? 48000);
        const pcm = new Uint8Array(512);
        injectAudioFrame(channels, sampleRate, pcm, timestampNs);
      }

      pulse = (pulse + 1) & 0xff;
    }, 50);

    sensorCleanupFns.push(() => {
      try {
        for (const track of stream.getTracks?.() ?? []) {
          track.stop?.();
        }
      } catch {
        // Ignore media cleanup failures.
      }
    });
  } catch (error) {
    post({ type: "TELEMETRY", message: `[HAL:MEDIA] getUserMedia rejected: ${String(error)}` });
  }
}

async function pollPeripheralDescriptors(): Promise<void> {
  const nav = (self as unknown as { navigator?: any }).navigator;
  const timestampNs = nowNs();

  if (nav?.usb?.getDevices) {
    try {
      const devices = await nav.usb.getDevices();
      for (const device of devices.slice(0, 4)) {
        const descriptor = `usb:${device.vendorId ?? 0}:${device.productId ?? 0}`;
        injectPeripheralToken(1, textEncoder.encode(descriptor), timestampNs);
      }
    } catch {
      // Ignore USB polling failures.
    }
  }

  if (nav?.bluetooth?.getDevices) {
    try {
      const devices = await nav.bluetooth.getDevices();
      for (const device of devices.slice(0, 4)) {
        const descriptor = `ble:${device.id ?? "unknown"}`;
        injectPeripheralToken(2, textEncoder.encode(descriptor), timestampNs);
      }
    } catch {
      // Ignore Bluetooth polling failures.
    }
  }

  if ((self as unknown as any).PublicKeyCredential) {
    injectPeripheralToken(3, textEncoder.encode("webauthn-capable"), timestampNs);
  }
}

function initPeripheralPolling(): void {
  void pollPeripheralDescriptors();

  peripheralPollTimer = self.setInterval(() => {
    void pollPeripheralDescriptors();
  }, 5_000);
}

function initializeHardwareListeners(): void {
  teardownHardwareListeners();
  initGeolocationListener();
  initSensorListeners();
  initGamepadPolling();
  initXrPolling();
  initPeripheralPolling();
  void initNfcListener();
  void initSerialListeners();
  void initMediaPipelines();

  setHapticsPattern([4, 6, 8], nowNs());
}

async function pushSnapshot(payload: Uint8Array, kind: string, sequence: number): Promise<void> {
  if (payload.byteLength === 0) {
    return;
  }

  markSyncStatus(1);

  try {
    const response = await fetch("/api/snapshot", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-session-id": activeSessionId,
        "x-payload-kind": kind,
        "x-seq-id": sequence.toString(),
      },
      cache: "no-store",
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`snapshot push failed (${response.status})`);
    }

    markSyncStatus(2);
  } catch (error) {
    markSyncStatus(-1);
    post({
      type: "TELEMETRY",
      message: `[SYNC] push failed kind=${kind} seq=${sequence}: ${String(error)}`,
    });
  }
}

function decodeZeroRle(encoded: Uint8Array, out: Uint8Array, expectedBytes: number): boolean {
  let inCursor = 0;
  let outCursor = 0;

  while (inCursor < encoded.length) {
    const token = encoded[inCursor] ?? 0;
    inCursor += 1;

    const run = (token & 0x7f) + 1;
    if ((token & 0x80) !== 0) {
      if (outCursor + run > expectedBytes) {
        return false;
      }

      out.fill(0, outCursor, outCursor + run);
      outCursor += run;
      continue;
    }

    if (inCursor + run > encoded.length || outCursor + run > expectedBytes) {
      return false;
    }

    out.set(encoded.subarray(inCursor, inCursor + run), outCursor);
    inCursor += run;
    outCursor += run;
  }

  return outCursor === expectedBytes;
}

function applyLegacyDeltaPayload(payload: Uint8Array): number {
  if (!exportsRef || payload.byteLength < 4 || pageScratchPtr === 0) {
    return 0;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const expectedPages = view.getUint32(0, true);

  let cursor = 4;
  let restored = 0;

  for (let i = 0; i < expectedPages; i += 1) {
    if (cursor + 4 + PAGE_SIZE > payload.byteLength) {
      break;
    }

    const pageIndex = view.getUint32(cursor, true);
    cursor += 4;

    const pageData = payload.subarray(cursor, cursor + PAGE_SIZE);
    wasmBytes().set(pageData, pageScratchPtr);
    cursor += PAGE_SIZE;

    const rc = exportsRef.os_write_page(pageIndex, pageScratchPtr, PAGE_SIZE);
    if (rc === 0) {
      restored += 1;
    }
  }

  return restored;
}

function applyCompactedPayload(payload: Uint8Array): { restoredPages: number; sequence: number } {
  if (!exportsRef || payload.byteLength < 16 || pageScratchPtr === 0) {
    return { restoredPages: 0, sequence: 0 };
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== COMPACTION_MAGIC) {
    return { restoredPages: 0, sequence: 0 };
  }

  const sequence = view.getUint32(4, true);
  const pageCount = view.getUint32(8, true);

  let cursor = 16;
  let restored = 0;

  for (let i = 0; i < pageCount; i += 1) {
    if (cursor + 12 > payload.byteLength) {
      break;
    }

    const pageIndex = view.getUint32(cursor, true);
    const rawLen = view.getUint32(cursor + 4, true);
    const encodedLen = view.getUint32(cursor + 8, true);
    cursor += 12;

    if (rawLen === 0 || rawLen > PAGE_SIZE || cursor + encodedLen > payload.byteLength) {
      break;
    }

    const encoded = payload.subarray(cursor, cursor + encodedLen);
    cursor += encodedLen;

    const rawTarget = new Uint8Array(exportsRef.memory.buffer, pageScratchPtr, rawLen);
    if (!decodeZeroRle(encoded, rawTarget, rawLen)) {
      continue;
    }

    const rc = exportsRef.os_write_page(pageIndex, pageScratchPtr, rawLen);
    if (rc === 0) {
      restored += 1;
    }
  }

  return { restoredPages: restored, sequence };
}

async function hydrateFromReplay(sessionId: string): Promise<void> {
  if (!exportsRef) {
    return;
  }

  try {
    const response = await fetch(
      `/api/snapshot?sessionId=${encodeURIComponent(sessionId)}&mode=replay`,
      {
        cache: "no-store",
      },
    );

    if (response.status === 204) {
      post({ type: "TELEMETRY", message: `[SYNC] no replay archive for ${sessionId}` });
      return;
    }

    if (!response.ok) {
      throw new Error(`replay fetch failed (${response.status})`);
    }

    const archive = new Uint8Array(await response.arrayBuffer());
    if (archive.byteLength < 4) {
      return;
    }

    const archiveView = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const magic = archiveView.getUint32(0, true);

    if (magic === COMPACTION_MAGIC) {
      const applied = applyCompactedPayload(archive);
      snapshotSequence = Math.max(snapshotSequence, applied.sequence + 1);
      post({
        type: "TELEMETRY",
        message: `[SYNC] hydrated ${applied.restoredPages} compacted pages from legacy payload`,
      });
      return;
    }

    if (magic !== REPLAY_MAGIC || archive.byteLength < 16) {
      const restored = applyLegacyDeltaPayload(archive);
      if (restored > 0) {
        post({ type: "TELEMETRY", message: `[SYNC] hydrated ${restored} pages from legacy delta` });
      }
      return;
    }

    const fragmentCount = archiveView.getUint32(8, true);
    let cursor = 16;
    let hydratedPages = 0;
    let maxSequenceSeen = 0;

    for (let i = 0; i < fragmentCount; i += 1) {
      if (cursor + 12 > archive.byteLength) {
        break;
      }

      const sequence = archiveView.getUint32(cursor, true);
      const kindCode = archiveView.getUint32(cursor + 4, true);
      const payloadBytes = archiveView.getUint32(cursor + 8, true);
      cursor += 12;

      if (cursor + payloadBytes > archive.byteLength) {
        break;
      }

      const fragmentPayload = archive.subarray(cursor, cursor + payloadBytes);
      cursor += payloadBytes;
      maxSequenceSeen = Math.max(maxSequenceSeen, sequence);

      if (kindCode === 2) {
        const applied = applyCompactedPayload(fragmentPayload);
        hydratedPages += applied.restoredPages;
      }

      if (kindCode === 3) {
        hydratedPages += applyLegacyDeltaPayload(fragmentPayload);
      }
    }

    snapshotSequence = Math.max(snapshotSequence, maxSequenceSeen + 1);

    post({
      type: "TELEMETRY",
      message: `[SYNC] replay hydration restored ${hydratedPages} pages from ${fragmentCount} fragments`,
    });
  } catch (error) {
    post({
      type: "TELEMETRY",
      message: `[SYNC] replay hydration failed: ${String(error)}`,
    });
  }
}

function drainInputRing(): number {
  if (!exportsRef || !inputHeader || !inputData || kernelSuspended) {
    return 0;
  }

  const capacity = Atomics.load(inputHeader, INPUT_CAPACITY_INDEX) >>> 0;
  if (capacity === 0) {
    return 0;
  }

  let read = Atomics.load(inputHeader, INPUT_READ_INDEX) >>> 0;
  const write = Atomics.load(inputHeader, INPUT_WRITE_INDEX) >>> 0;
  const available = write - read;
  const limit = Math.min(available, MAX_INPUT_BATCH);

  for (let i = 0; i < limit; i += 1) {
    const slot = read % capacity;
    const offset = slot * INPUT_SLOT_BYTES;

    const eventType = inputData.getUint32(offset + INPUT_EVENT_TYPE_OFFSET, true);
    const paramA = inputData.getFloat32(offset + INPUT_EVENT_A_OFFSET, true);
    const paramB = inputData.getFloat32(offset + INPUT_EVENT_B_OFFSET, true);
    const modifierFlags = inputData.getUint32(offset + INPUT_EVENT_MOD_OFFSET, true);

    exportsRef.os_process_input(eventType, paramA, paramB, modifierFlags);
    read += 1;
  }

  Atomics.store(inputHeader, INPUT_READ_INDEX, read | 0);
  return limit;
}

function copyRenderTree(): void {
  if (!exportsRef || !renderHeader || !renderBytes || renderTreePtr === 0) {
    return;
  }

  const nodeCount = exportsRef.os_get_render_tree(renderTreePtr, MAX_RENDER_NODES);
  if (nodeCount <= 0) {
    Atomics.store(renderHeader, RENDER_NODE_COUNT_INDEX, 0);
    return;
  }

  const bytes = wasmBytes();
  const copyBytes = Math.min(nodeCount * WINDOW_NODE_STRIDE, renderBytes.byteLength);
  renderBytes.set(bytes.subarray(renderTreePtr, renderTreePtr + copyBytes), 0);

  Atomics.store(renderHeader, RENDER_NODE_COUNT_INDEX, nodeCount);
  Atomics.add(renderHeader, RENDER_SEQUENCE_INDEX, 1);
}

function mirrorMetrics(): void {
  if (!exportsRef || !metricsHeader || metricsPtr === 0) {
    return;
  }

  const count = exportsRef.os_get_metrics(metricsPtr, METRICS_SLOTS);
  if (count <= 0) {
    return;
  }

  const metrics = new Uint32Array(exportsRef.memory.buffer, metricsPtr, METRICS_SLOTS);

  Atomics.store(metricsHeader, METRICS_TICK_LOW_INDEX, metrics[0] ?? 0);
  Atomics.store(metricsHeader, METRICS_TICK_HIGH_INDEX, metrics[1] ?? 0);
  Atomics.store(metricsHeader, METRICS_TOTAL_PAGES_INDEX, metrics[2] ?? 0);
  Atomics.store(metricsHeader, METRICS_DIRTY_PAGES_INDEX, metrics[3] ?? 0);
  Atomics.store(metricsHeader, METRICS_ACTIVE_APPS_INDEX, metrics[4] ?? 0);
  Atomics.store(metricsHeader, METRICS_PENDING_INPUT_INDEX, metrics[5] ?? 0);
  Atomics.store(metricsHeader, METRICS_COMPACTION_SEQ_INDEX, metrics[6] ?? 0);
  Atomics.store(metricsHeader, METRICS_LAST_COMPACTED_PAGES_INDEX, metrics[7] ?? 0);
  Atomics.add(metricsHeader, METRICS_SEQUENCE_INDEX, 1);

  const tick = (BigInt(metrics[1] ?? 0) << 32n) | BigInt(metrics[0] ?? 0);
  post({
    type: "SYSTEM_METRICS",
    tick,
    totalPages: metrics[2] ?? 0,
    dirtyPages: metrics[3] ?? 0,
    activeApps: metrics[4] ?? 0,
    pendingInput: metrics[5] ?? 0,
    compactionSequence: metrics[6] ?? 0,
    compactedPages: metrics[7] ?? 0,
  });
}

function mirrorTerminal(): void {
  if (!exportsRef || !terminalHeader || !terminalBytes || terminalPtr === 0) {
    return;
  }

  const bytes = exportsRef.os_terminal_snapshot(terminalPtr, TERMINAL_SNAPSHOT_BYTES);
  if (bytes <= 16) {
    return;
  }

  const snapshot = new Uint8Array(exportsRef.memory.buffer, terminalPtr, bytes);
  const view = new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);

  const cols = view.getUint16(0, true);
  const rows = view.getUint16(2, true);
  const cursorX = view.getUint16(4, true);
  const cursorY = view.getUint16(6, true);
  const sequence = view.getUint32(8, true);
  const textLen = Math.min(view.getUint32(12, true), snapshot.byteLength - 16, terminalBytes.byteLength);

  terminalBytes.set(snapshot.subarray(16, 16 + textLen), 0);

  Atomics.store(terminalHeader, TERMINAL_SEQUENCE_INDEX, sequence | 0);
  Atomics.store(terminalHeader, TERMINAL_COLS_INDEX, cols | 0);
  Atomics.store(terminalHeader, TERMINAL_ROWS_INDEX, rows | 0);
  Atomics.store(terminalHeader, TERMINAL_CURSOR_X_INDEX, cursorX | 0);
  Atomics.store(terminalHeader, TERMINAL_CURSOR_Y_INDEX, cursorY | 0);
  Atomics.store(terminalHeader, TERMINAL_TEXT_LEN_INDEX, textLen | 0);
}

function mirrorEditor(): void {
  if (!exportsRef || !editorHeader || !editorBytes || editorPtr === 0) {
    return;
  }

  const bytes = exportsRef.os_editor_snapshot(editorPtr, EDITOR_SNAPSHOT_BYTES);
  if (bytes <= 16) {
    return;
  }

  const snapshot = new Uint8Array(exportsRef.memory.buffer, editorPtr, bytes);
  const view = new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);

  const sequence = view.getUint32(0, true);
  const cursor = view.getUint32(4, true);
  const textLen = Math.min(view.getUint32(8, true), snapshot.byteLength - 16, editorBytes.byteLength);
  const flags = view.getUint32(12, true);

  editorBytes.set(snapshot.subarray(16, 16 + textLen), 0);

  Atomics.store(editorHeader, EDITOR_SEQUENCE_INDEX, sequence | 0);
  Atomics.store(editorHeader, EDITOR_CURSOR_INDEX, cursor | 0);
  Atomics.store(editorHeader, EDITOR_TEXT_LEN_INDEX, textLen | 0);
  Atomics.store(editorHeader, EDITOR_FLAGS_INDEX, flags | 0);
}

function mirrorMedia(): void {
  if (!exportsRef || !mediaHeader || mediaPtr === 0) {
    return;
  }

  const bytes = exportsRef.os_media_snapshot(mediaPtr, MEDIA_SNAPSHOT_BYTES);
  if (bytes < 20) {
    return;
  }

  const view = new DataView(exportsRef.memory.buffer, mediaPtr, bytes);
  Atomics.store(mediaHeader, MEDIA_SEQUENCE_INDEX, view.getUint32(0, true) | 0);
  Atomics.store(mediaHeader, MEDIA_STREAM_COUNT_INDEX, view.getUint32(4, true) | 0);
  Atomics.store(mediaHeader, MEDIA_PCM_LOW_INDEX, view.getUint32(8, true) | 0);
  Atomics.store(mediaHeader, MEDIA_PCM_HIGH_INDEX, view.getUint32(12, true) | 0);
  Atomics.store(mediaHeader, MEDIA_CAPTURE_SEQUENCE_INDEX, view.getUint32(16, true) | 0);
}

function mirrorFileExplorer(): void {
  if (!exportsRef || !fileExplorerHeader || !fileExplorerBytes || fileExplorerPtr === 0) {
    return;
  }

  const bytes = exportsRef.os_fs_explorer_snapshot(fileExplorerPtr, FILE_EXPLORER_SNAPSHOT_BYTES);
  if (bytes < 8) {
    return;
  }

  const snapshot = new Uint8Array(exportsRef.memory.buffer, fileExplorerPtr, bytes);
  const view = new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
  const sequence = view.getUint32(0, true);
  const entryCount = view.getUint32(4, true);

  const lines: string[] = [];
  let cursor = 8;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 12 > snapshot.byteLength) {
      break;
    }

    const pathLen = view.getUint32(cursor, true);
    const kind = view.getUint32(cursor + 4, true);
    const syncState = view.getUint32(cursor + 8, true);
    cursor += 12;

    if (cursor + pathLen > snapshot.byteLength) {
      break;
    }

    const path = textDecoder.decode(snapshot.subarray(cursor, cursor + pathLen));
    cursor += pathLen;

    const kindLabel = kind === 1 ? "dir" : "file";
    const syncLabel = syncState === 2 ? "synced" : syncState === 1 ? "dirty" : "queued";
    lines.push(`[${syncLabel}] ${kindLabel} ${path}`);
  }

  const encoded = textEncoder.encode(lines.join("\n"));
  const writeLen = Math.min(encoded.byteLength, fileExplorerBytes.byteLength);
  fileExplorerBytes.fill(0);
  fileExplorerBytes.set(encoded.subarray(0, writeLen), 0);

  Atomics.store(fileExplorerHeader, FILES_SEQUENCE_INDEX, sequence | 0);
  Atomics.store(fileExplorerHeader, FILES_ENTRY_COUNT_INDEX, entryCount | 0);
  Atomics.store(fileExplorerHeader, FILES_TEXT_LEN_INDEX, writeLen | 0);
}

async function flushCompactedDirty(force = false): Promise<void> {
  if (!exportsRef || kernelSuspended || compactionPtr === 0) {
    return;
  }

  let loopGuard = force ? 4 : 1;
  while (loopGuard > 0) {
    const bytes = exportsRef.os_compact_dirty(compactionPtr, COMPACTION_BUFFER_BYTES, MAX_COMPACTION_PAGES);
    if (bytes <= 0) {
      return;
    }

    const payload = wasmBytes().slice(compactionPtr, compactionPtr + bytes);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const magic = payload.byteLength >= 16 ? view.getUint32(0, true) : 0;
    const sequence =
      magic === COMPACTION_MAGIC && payload.byteLength >= 16
        ? nextSnapshotSequence(view.getUint32(4, true))
        : nextSnapshotSequence();
    const pages = magic === COMPACTION_MAGIC && payload.byteLength >= 16 ? view.getUint32(8, true) : 0;

    await pushSnapshot(payload, "compacted", sequence);

    post({
      type: "DELTA_PUSHED",
      bytes: payload.byteLength,
      pages,
      sequence,
      kind: "compacted",
    });

    loopGuard -= 1;
  }
}

function listApps(): void {
  if (!exportsRef || appListPtr === 0) {
    return;
  }

  const count = exportsRef.os_list_apps(appListPtr, APP_LIST_CAPACITY);
  if (count < 0) {
    return;
  }

  const apps: AppDescriptor[] = [];
  const view = new DataView(exportsRef.memory.buffer, appListPtr, APP_LIST_CAPACITY * APP_DESCRIPTOR_BYTES);

  for (let i = 0; i < count; i += 1) {
    const offset = i * APP_DESCRIPTOR_BYTES;
    apps.push({
      appId: view.getUint32(offset + 0, true),
      windowId: view.getUint32(offset + 4, true),
      kind: view.getUint32(offset + 8, true),
      status: view.getUint32(offset + 12, true),
      arenaOffset: view.getUint32(offset + 16, true),
      arenaLen: view.getUint32(offset + 20, true),
    });
  }

  runtimeApps = apps.filter((app) => app.kind === APP_KIND_ANDROID_RUNTIME && app.status === 1);
  if (androidTickCursor >= runtimeApps.length) {
    androidTickCursor = 0;
  }

  post({ type: "APP_LIST", apps });
}

function tickAndroidRuntime(): void {
  if (!exportsRef || runtimeApps.length === 0) {
    return;
  }

  if (androidTickCursor >= runtimeApps.length) {
    androidTickCursor = 0;
  }

  const target = runtimeApps[androidTickCursor];
  androidTickCursor = (androidTickCursor + 1) % runtimeApps.length;

  const rc = exportsRef.android_vm_tick(target.appId);
  if (rc < 0 && rc !== -2) {
    post({
      type: "TELEMETRY",
      message: `[ANR] android_vm_tick app=${target.appId} failed (${rc})`,
    });
  }
}

function tickKernel(): void {
  if (!exportsRef || kernelSuspended) {
    return;
  }

  drainInputRing();

  const deadline = BigInt(Math.floor(performance.now() * 1_000_000 + 8_000_000));
  const rc = exportsRef.os_poll(deadline);
  if (rc < 0) {
    post({ type: "OS_FAULT", message: `os_poll failed (${rc})` });
    return;
  }

  tickAndroidRuntime();
  copyRenderTree();
}

function startLoops(): void {
  clearTimers();

  pollTimer = self.setInterval(() => {
    tickKernel();
  }, 8);

  compactionTimer = self.setInterval(() => {
    void flushCompactedDirty(false);
  }, 2_000);

  metricsTimer = self.setInterval(() => {
    mirrorMetrics();
  }, 250);

  appMirrorTimer = self.setInterval(() => {
    mirrorTerminal();
    mirrorEditor();
    mirrorMedia();
    mirrorFileExplorer();
  }, 60);

  telemetryTimer = self.setInterval(() => {
    if (!inputHeader) {
      return;
    }

    const backlog = ringBacklog(inputHeader);
    const dropped = Atomics.load(inputHeader, INPUT_DROPPED_INDEX);
    post({
      type: "TELEMETRY",
      message: `[INPUT] backlog=${backlog} dropped=${dropped}`,
    });
  }, 2_000);
}

function installHostImports(memory: WebAssembly.Memory) {
  return {
    env: {
      memory,
    },
    "host-sync": {
      host_sync: (ptr: number, len: number): number => {
        if (!exportsRef || ptr === 0 || len <= 0) {
          return 0;
        }

        const payload = wasmBytes().slice(ptr, ptr + len);
        const sequence = nextSnapshotSequence();
        void pushSnapshot(payload, "manifest", sequence);

        post({
          type: "DELTA_PUSHED",
          bytes: payload.byteLength,
          pages: 0,
          sequence,
          kind: "manifest",
        });

        return 0;
      },
      host_log: (ptr: number, len: number): void => {
        if (ptr === 0 || len <= 0) {
          return;
        }

        const message = textDecoder.decode(wasmBytes().subarray(ptr, ptr + len));
        post({ type: "TELEMETRY", message });
      },
    },
  };
}

async function initKernel(payload: InitPayload): Promise<void> {
  if (initInFlight || exportsRef) {
    return;
  }

  initInFlight = true;

  try {
    bindSharedBuffers(payload);
    activeSessionId = payload.sessionId;

    const moduleBytes = await fetch(payload.wasmUrl, { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error(`failed to load ${payload.wasmUrl} (${response.status})`);
      }

      return response.arrayBuffer();
    });

    const memory = new WebAssembly.Memory({
      initial: payload.initialPages,
      maximum: payload.maximumPages,
      shared: true,
    });

    const imports = installHostImports(memory);
    const result = await WebAssembly.instantiate(moduleBytes, imports as WebAssembly.Imports);
    exportsRef = result.instance.exports as unknown as CoreOsExports;

    const ramBytes = payload.initialPages * PAGE_SIZE;
    const bootRc = exportsRef.os_boot(ramBytes, payload.flags);
    if (bootRc < 0) {
      throw new Error(`os_boot failed (${bootRc})`);
    }

    allocateScratch();
    await hydrateFromReplay(activeSessionId);

    const sessionHandle = writeUtf8(activeSessionId);
    const resumeRc = exportsRef.os_resume(sessionHandle?.ptr ?? 0, sessionHandle?.len ?? 0);
    freeUtf8(sessionHandle);
    if (resumeRc < 0) {
      throw new Error(`os_resume failed (${resumeRc})`);
    }

    kernelSuspended = false;
    startLoops();
    listApps();
    initializeHardwareListeners();

    post({
      type: "OS_READY",
      memoryBytes: ramBytes,
      sessionId: activeSessionId,
    });

    post({
      type: "OS_RESUMED",
      sessionId: activeSessionId,
    });
  } catch (error) {
    post({ type: "OS_FAULT", message: String(error) });
  } finally {
    initInFlight = false;
  }
}

function suspendKernel(): void {
  if (!exportsRef || kernelSuspended) {
    return;
  }

  kernelSuspended = true;
  const rc = exportsRef.os_suspend();
  if (rc < 0) {
    post({ type: "OS_FAULT", message: `os_suspend failed (${rc})` });
    kernelSuspended = false;
    return;
  }

  void flushCompactedDirty(true);
  post({ type: "OS_SUSPENDED" });
}

function resumeKernel(sessionId?: string): void {
  if (!exportsRef) {
    return;
  }

  const nextSession = sessionId && sessionId.length > 0 ? sessionId : activeSessionId;
  activeSessionId = nextSession;

  const handle = writeUtf8(nextSession);
  const rc = exportsRef.os_resume(handle?.ptr ?? 0, handle?.len ?? 0);
  freeUtf8(handle);

  if (rc < 0) {
    post({ type: "OS_FAULT", message: `os_resume failed (${rc})` });
    return;
  }

  kernelSuspended = false;
  post({ type: "OS_RESUMED", sessionId: nextSession });
}

async function checkpointNow(): Promise<void> {
  if (!exportsRef) {
    return;
  }

  const wasSuspended = kernelSuspended;
  if (!wasSuspended) {
    suspendKernel();
  }

  await flushCompactedDirty(true);

  if (!wasSuspended) {
    resumeKernel(activeSessionId);
  }
}

function loadComponent(kind: number, path?: string): void {
  if (!exportsRef) {
    return;
  }

  let appId = -1;
  if (typeof path === "string" && path.length > 0) {
    const launchHandle = writeUtf8(path);
    appId = exportsRef.activity_launch(launchHandle?.ptr ?? 0, launchHandle?.len ?? 0, kind | 0);
    freeUtf8(launchHandle);
  } else {
    appId = exportsRef.os_load_component(kind | 0, 0, 0);
  }

  if (appId < 0) {
    post({ type: "OS_FAULT", message: `component launch failed (${appId})` });
    return;
  }

  post({ type: "APP_LOADED", appId, kind });
  listApps();
}

function packageNameFromVfsPath(vfsPath: string): string {
  const normalized = vfsPath.trim().toLowerCase();
  if (normalized.endsWith("/base.apk")) {
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return parts[parts.length - 2] ?? "android-app";
    }
  }

  const tail = normalized.split("/").pop() ?? "android-app.apk";
  return tail.replace(/\.apk$/i, "") || "android-app";
}

function installApk(vfsPath: string): void {
  if (!exportsRef) {
    return;
  }

  const handle = writeUtf8(vfsPath);
  const rc = exportsRef.android_deploy_apk(handle?.ptr ?? 0, handle?.len ?? 0);
  freeUtf8(handle);

  if (rc < 0) {
    post({ type: "OS_FAULT", message: `android_deploy_apk failed (${rc})` });
    return;
  }

  const packageName = packageNameFromVfsPath(vfsPath);
  post({
    type: "APK_DEPLOYED",
    packageName,
    mountPath: `/data/app/${packageName}`,
    installedCount: rc,
  });

  mirrorFileExplorer();
  listApps();
}

function startAndroidActivity(request: {
  action: string;
  categories: string[];
  dataUri: string;
  packageName: string;
  className: string;
}): void {
  if (!exportsRef) {
    return;
  }

  const payload = [
    request.action ?? "android.intent.action.VIEW",
    (request.categories ?? []).join(","),
    request.dataUri ?? "",
    request.packageName ?? "",
    request.className ?? "MainActivity",
  ].join("\n");

  const handle = writeUtf8(payload);
  const appId = exportsRef.android_start_activity(handle?.ptr ?? 0, handle?.len ?? 0);
  freeUtf8(handle);

  if (appId < 0) {
    post({ type: "OS_FAULT", message: `android_start_activity failed (${appId})` });
    return;
  }

  post({
    type: "ANDROID_ACTIVITY_STARTED",
    appId,
    packageName: request.packageName || "android-app",
    className: request.className || "MainActivity",
  });

  listApps();
}

async function clearSessionCache(sessionId?: string): Promise<void> {
  const id = sessionId && sessionId.length > 0 ? sessionId : activeSessionId;

  try {
    const response = await fetch(`/api/snapshot?sessionId=${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`clear failed (${response.status})`);
    }

    post({ type: "TELEMETRY", message: `[SYNC] cleared replay store for ${id}` });
  } catch (error) {
    post({ type: "TELEMETRY", message: `[SYNC] clear failed for ${id}: ${String(error)}` });
  }
}

function shutdownKernel(): void {
  clearTimers();
  teardownHardwareListeners();

  if (exportsRef && !kernelSuspended) {
    const rc = exportsRef.os_suspend();
    if (rc < 0) {
      post({ type: "TELEMETRY", message: `[KERNEL] suspend during shutdown failed (${rc})` });
    }
  }

  kernelSuspended = true;
  runtimeApps = [];
  androidTickCursor = 0;
  releaseScratch();
  exportsRef = null;
}

self.onmessage = (event: MessageEvent<UiToWorker>): void => {
  const message = event.data;

  if (message.type === "INIT_OS") {
    void initKernel(message.payload);
    return;
  }

  if (message.type === "SUSPEND_OS") {
    suspendKernel();
    return;
  }

  if (message.type === "RESUME_OS") {
    resumeKernel(message.sessionId);
    return;
  }

  if (message.type === "REQUEST_CHECKPOINT") {
    void checkpointNow();
    return;
  }

  if (message.type === "LOAD_COMPONENT") {
    loadComponent(message.kind, message.path);
    return;
  }

  if (message.type === "INSTALL_APK") {
    installApk(message.vfsPath);
    return;
  }

  if (message.type === "START_ANDROID_ACTIVITY") {
    startAndroidActivity(message);
    return;
  }

  if (message.type === "CLEAR_SESSION_CACHE") {
    void clearSessionCache(message.sessionId);
    return;
  }

  if (message.type === "PUSH_INPUT") {
    if (!exportsRef) {
      return;
    }

    exportsRef.os_process_input(message.eventType, message.paramA, message.paramB, message.modifierFlags);
    return;
  }

  shutdownKernel();
};
