export const PAGE_SIZE = 64 * 1024;

export const INPUT_RING_CAPACITY = 2048;
export const INPUT_HEADER_INTS = 16;
export const INPUT_HEADER_BYTES = INPUT_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
export const INPUT_SLOT_BYTES = 24;

export const INPUT_EVENT_TYPE_OFFSET = 0;
export const INPUT_EVENT_A_OFFSET = 4;
export const INPUT_EVENT_B_OFFSET = 8;
export const INPUT_EVENT_MOD_OFFSET = 12;
export const INPUT_EVENT_TIME_LOW_OFFSET = 16;
export const INPUT_EVENT_TIME_HIGH_OFFSET = 20;

export const INPUT_WRITE_INDEX = 0;
export const INPUT_READ_INDEX = 1;
export const INPUT_DROPPED_INDEX = 2;
export const INPUT_CAPACITY_INDEX = 3;
export const INPUT_SEQUENCE_INDEX = 4;

export const RENDER_HEADER_INTS = 16;
export const RENDER_HEADER_BYTES = RENDER_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;

export const RENDER_SEQUENCE_INDEX = 0;
export const RENDER_NODE_COUNT_INDEX = 1;
export const RENDER_WIDTH_INDEX = 2;
export const RENDER_HEIGHT_INDEX = 3;
export const RENDER_ACTIVE_ID_INDEX = 4;

export const METRICS_HEADER_INTS = 16;
export const METRICS_SEQUENCE_INDEX = 0;
export const METRICS_TICK_LOW_INDEX = 1;
export const METRICS_TICK_HIGH_INDEX = 2;
export const METRICS_TOTAL_PAGES_INDEX = 3;
export const METRICS_DIRTY_PAGES_INDEX = 4;
export const METRICS_ACTIVE_APPS_INDEX = 5;
export const METRICS_PENDING_INPUT_INDEX = 6;
export const METRICS_COMPACTION_SEQ_INDEX = 7;
export const METRICS_LAST_COMPACTED_PAGES_INDEX = 8;
export const METRICS_SYNC_STATUS_INDEX = 9;

export const APP_KIND_TERMINAL = 1;
export const APP_KIND_EDITOR = 2;
export const APP_KIND_SETTINGS = 3;
export const APP_KIND_LAUNCHER = 4;
export const APP_KIND_FILE_EXPLORER = 5;
export const APP_KIND_PHOTO_VIEWER = 6;
export const APP_KIND_SCREEN_CAPTURE = 7;
export const APP_KIND_VOICE_RECORDER = 8;
export const APP_KIND_AUDIO_PLAYER = 9;

export const INPUT_EVENT_TERMINAL_KEY = 16;
export const INPUT_EVENT_EDITOR_KEY = 17;
export const INPUT_EVENT_LOAD_APP = 18;

export const APP_DESCRIPTOR_STRIDE_BYTES = 24;

export const MEDIA_HEADER_INTS = 16;
export const MEDIA_SEQUENCE_INDEX = 0;
export const MEDIA_STREAM_COUNT_INDEX = 1;
export const MEDIA_PCM_LOW_INDEX = 2;
export const MEDIA_PCM_HIGH_INDEX = 3;
export const MEDIA_CAPTURE_SEQUENCE_INDEX = 4;

export const FILES_HEADER_INTS = 16;
export const FILES_SEQUENCE_INDEX = 0;
export const FILES_ENTRY_COUNT_INDEX = 1;
export const FILES_TEXT_LEN_INDEX = 2;
export const FILES_TEXT_BYTES_OFFSET = FILES_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
export const FILES_TEXT_CAPACITY = 64 * 1024;

export const HARDWARE_HAL_HEADER_INTS = 32;
export const HAL_SEQUENCE_INDEX = 0;
export const HAL_SENSOR_SEQUENCE_INDEX = 1;
export const HAL_LOCATION_SEQUENCE_INDEX = 2;
export const HAL_AUDIO_SEQUENCE_INDEX = 3;
export const HAL_CAMERA_SEQUENCE_INDEX = 4;
export const HAL_PERIPHERAL_SEQUENCE_INDEX = 5;
export const HAL_NFC_SEQUENCE_INDEX = 6;
export const HAL_GAMEPAD_SEQUENCE_INDEX = 7;
export const HAL_SERIAL_SEQUENCE_INDEX = 8;
export const HAL_XR_SEQUENCE_INDEX = 9;
export const HAL_HAPTICS_SEQUENCE_INDEX = 10;
export const HAL_SENSOR_WRITE_INDEX = 11;

export const HARDWARE_HAL_BYTES_OFFSET = HARDWARE_HAL_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;

export const HAL_SENSOR_RING_CAPACITY = 512;
export const HAL_SENSOR_SLOT_BYTES = 32;
export const HAL_SENSOR_ID_OFFSET = 0;
export const HAL_SENSOR_X_OFFSET = 4;
export const HAL_SENSOR_Y_OFFSET = 8;
export const HAL_SENSOR_Z_OFFSET = 12;
export const HAL_SENSOR_TS_LOW_OFFSET = 16;
export const HAL_SENSOR_TS_HIGH_OFFSET = 20;
export const HAL_SENSOR_SEQ_LOW_OFFSET = 24;
export const HAL_SENSOR_SEQ_HIGH_OFFSET = 28;

export const HAL_SENSOR_RING_OFFSET = HARDWARE_HAL_BYTES_OFFSET;

export const HAL_LOCATION_BLOCK_OFFSET =
  HAL_SENSOR_RING_OFFSET + HAL_SENSOR_RING_CAPACITY * HAL_SENSOR_SLOT_BYTES;
export const HAL_LOCATION_BLOCK_BYTES = 64;

export const HAL_AUDIO_BLOCK_OFFSET = HAL_LOCATION_BLOCK_OFFSET + HAL_LOCATION_BLOCK_BYTES;
export const HAL_AUDIO_BLOCK_BYTES = 12 * 1024;

export const HAL_CAMERA_BLOCK_OFFSET = HAL_AUDIO_BLOCK_OFFSET + HAL_AUDIO_BLOCK_BYTES;
export const HAL_CAMERA_BLOCK_BYTES = 20 * 1024;

export const HAL_PERIPHERAL_BLOCK_OFFSET = HAL_CAMERA_BLOCK_OFFSET + HAL_CAMERA_BLOCK_BYTES;
export const HAL_PERIPHERAL_BLOCK_BYTES = 2048;

export const HAL_NFC_BLOCK_OFFSET = HAL_PERIPHERAL_BLOCK_OFFSET + HAL_PERIPHERAL_BLOCK_BYTES;
export const HAL_NFC_BLOCK_BYTES = 4096;

export const HAL_GAMEPAD_BLOCK_OFFSET = HAL_NFC_BLOCK_OFFSET + HAL_NFC_BLOCK_BYTES;
export const HAL_GAMEPAD_BLOCK_BYTES = 4096;

export const HAL_SERIAL_BLOCK_OFFSET = HAL_GAMEPAD_BLOCK_OFFSET + HAL_GAMEPAD_BLOCK_BYTES;
export const HAL_SERIAL_BLOCK_BYTES = 4096;

export const HAL_XR_BLOCK_OFFSET = HAL_SERIAL_BLOCK_OFFSET + HAL_SERIAL_BLOCK_BYTES;
export const HAL_XR_BLOCK_BYTES = 4096;

export const HAL_HAPTIC_BLOCK_OFFSET = HAL_XR_BLOCK_OFFSET + HAL_XR_BLOCK_BYTES;
export const HAL_HAPTIC_BLOCK_BYTES = 1024;

export const HARDWARE_HAL_BUFFER_BYTES = HAL_HAPTIC_BLOCK_OFFSET + HAL_HAPTIC_BLOCK_BYTES;

export const TERMINAL_HEADER_INTS = 16;
export const TERMINAL_SEQUENCE_INDEX = 0;
export const TERMINAL_COLS_INDEX = 1;
export const TERMINAL_ROWS_INDEX = 2;
export const TERMINAL_CURSOR_X_INDEX = 3;
export const TERMINAL_CURSOR_Y_INDEX = 4;
export const TERMINAL_TEXT_LEN_INDEX = 5;
export const TERMINAL_TEXT_BYTES_OFFSET = TERMINAL_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
export const TERMINAL_TEXT_CAPACITY = 64 * 1024;

export const EDITOR_HEADER_INTS = 16;
export const EDITOR_SEQUENCE_INDEX = 0;
export const EDITOR_CURSOR_INDEX = 1;
export const EDITOR_TEXT_LEN_INDEX = 2;
export const EDITOR_FLAGS_INDEX = 3;
export const EDITOR_TEXT_BYTES_OFFSET = EDITOR_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
export const EDITOR_TEXT_CAPACITY = 128 * 1024;

export const MAX_RENDER_NODES = 192;
export const WINDOW_NODE_STRIDE = 64;

export const DEFAULT_VIRTUAL_WIDTH = 1920;
export const DEFAULT_VIRTUAL_HEIGHT = 1080;

export type InputEventPacket = {
  eventType: number;
  paramA: number;
  paramB: number;
  modifierFlags: number;
  timestampNs?: bigint;
};

export type WindowNodePacket = {
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

export type InputRingViews = {
  header: Int32Array;
  data: DataView;
};

export type InputPacket = {
  eventType: number;
  paramA: number;
  paramB: number;
  modifierFlags: number;
  timestampNs?: bigint;
};

export function createInputRingBuffer(capacity = INPUT_RING_CAPACITY): SharedArrayBuffer {
  const safeCapacity = Math.max(64, capacity | 0);
  const bytes = INPUT_HEADER_BYTES + safeCapacity * INPUT_SLOT_BYTES;
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, INPUT_HEADER_INTS);
  header.fill(0);
  Atomics.store(header, INPUT_CAPACITY_INDEX, safeCapacity);
  return buffer;
}

export function createRenderTreeBuffer(
  virtualWidth = DEFAULT_VIRTUAL_WIDTH,
  virtualHeight = DEFAULT_VIRTUAL_HEIGHT,
): SharedArrayBuffer {
  const bytes = RENDER_HEADER_BYTES + MAX_RENDER_NODES * WINDOW_NODE_STRIDE;
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, RENDER_HEADER_INTS);
  header.fill(0);
  Atomics.store(header, RENDER_WIDTH_INDEX, virtualWidth | 0);
  Atomics.store(header, RENDER_HEIGHT_INDEX, virtualHeight | 0);
  return buffer;
}

export function createSystemMetricsBuffer(): SharedArrayBuffer {
  const bytes = METRICS_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, METRICS_HEADER_INTS);
  header.fill(0);
  return buffer;
}

export function createTerminalBuffer(capacity = TERMINAL_TEXT_CAPACITY): SharedArrayBuffer {
  const bytes = TERMINAL_TEXT_BYTES_OFFSET + Math.max(1024, capacity | 0);
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, TERMINAL_HEADER_INTS);
  header.fill(0);
  Atomics.store(header, TERMINAL_COLS_INDEX, 80);
  Atomics.store(header, TERMINAL_ROWS_INDEX, 28);
  return buffer;
}

export function createEditorBuffer(capacity = EDITOR_TEXT_CAPACITY): SharedArrayBuffer {
  const bytes = EDITOR_TEXT_BYTES_OFFSET + Math.max(2048, capacity | 0);
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, EDITOR_HEADER_INTS);
  header.fill(0);
  return buffer;
}

export function createMediaBuffer(): SharedArrayBuffer {
  const bytes = MEDIA_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, MEDIA_HEADER_INTS);
  header.fill(0);
  return buffer;
}

export function createFileExplorerBuffer(capacity = FILES_TEXT_CAPACITY): SharedArrayBuffer {
  const bytes = FILES_TEXT_BYTES_OFFSET + Math.max(2048, capacity | 0);
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, FILES_HEADER_INTS);
  header.fill(0);
  return buffer;
}

export function createHardwareHalBuffer(): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(HARDWARE_HAL_BUFFER_BYTES);
  const header = new Int32Array(buffer, 0, HARDWARE_HAL_HEADER_INTS);
  header.fill(0);
  Atomics.store(header, HAL_SENSOR_WRITE_INDEX, 0);
  return buffer;
}

export function createInputRingViews(buffer: SharedArrayBuffer): InputRingViews {
  return {
    header: new Int32Array(buffer, 0, INPUT_HEADER_INTS),
    data: new DataView(buffer, INPUT_HEADER_BYTES),
  };
}

export function pushInputPacket(views: InputRingViews, packet: InputPacket): boolean {
  const capacity = Atomics.load(views.header, INPUT_CAPACITY_INDEX) >>> 0;
  if (capacity === 0) {
    return false;
  }

  const read = Atomics.load(views.header, INPUT_READ_INDEX) >>> 0;
  const write = Atomics.load(views.header, INPUT_WRITE_INDEX) >>> 0;
  if (write - read >= capacity) {
    Atomics.add(views.header, INPUT_DROPPED_INDEX, 1);
    return false;
  }

  const slot = write % capacity;
  const offset = slot * INPUT_SLOT_BYTES;
  const timestampNs =
    packet.timestampNs ?? BigInt(Math.floor((performance.timeOrigin + performance.now()) * 1_000_000));

  views.data.setUint32(offset + INPUT_EVENT_TYPE_OFFSET, packet.eventType >>> 0, true);
  views.data.setFloat32(offset + INPUT_EVENT_A_OFFSET, packet.paramA, true);
  views.data.setFloat32(offset + INPUT_EVENT_B_OFFSET, packet.paramB, true);
  views.data.setUint32(offset + INPUT_EVENT_MOD_OFFSET, packet.modifierFlags >>> 0, true);
  views.data.setUint32(offset + INPUT_EVENT_TIME_LOW_OFFSET, Number(timestampNs & 0xffffffffn), true);
  views.data.setUint32(
    offset + INPUT_EVENT_TIME_HIGH_OFFSET,
    Number((timestampNs >> 32n) & 0xffffffffn),
    true,
  );

  Atomics.store(views.header, INPUT_WRITE_INDEX, (write + 1) | 0);
  return true;
}

export function ringBacklog(header: Int32Array): number {
  const write = Atomics.load(header, INPUT_WRITE_INDEX) >>> 0;
  const read = Atomics.load(header, INPUT_READ_INDEX) >>> 0;
  return write - read;
}
