export const PAGE_SIZE = 64 * 1024;

export const INPUT_RING_CAPACITY = 2048;
export const INPUT_HEADER_INTS = 16;
export const INPUT_HEADER_BYTES = INPUT_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
export const INPUT_SLOT_BYTES = 24;

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

export function ringBacklog(header: Int32Array): number {
  const write = Atomics.load(header, INPUT_WRITE_INDEX) >>> 0;
  const read = Atomics.load(header, INPUT_READ_INDEX) >>> 0;
  return write - read;
}
