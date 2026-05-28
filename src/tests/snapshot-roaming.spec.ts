import { describe, expect, it } from "vitest";

import { DELETE, GET, POST } from "@/app/api/snapshot/route";
import { PAGE_SIZE } from "@/lib/spatialShared";

const COMPACTION_MAGIC = 0x3144_5043;
const REPLAY_MAGIC = 0x3156_4c52;

type ReplayFragment = {
  seq: number;
  kindCode: number;
  payload: Uint8Array;
};

function setU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function rleZeroEncode(input: Uint8Array): Uint8Array {
  const output: number[] = [];
  let i = 0;

  while (i < input.length) {
    if (input[i] === 0) {
      let run = 1;
      while (i + run < input.length && run < 128 && input[i + run] === 0) {
        run += 1;
      }

      output.push(0x80 | (run - 1));
      i += run;
      continue;
    }

    let run = 1;
    while (i + run < input.length && run < 128 && input[i + run] !== 0) {
      run += 1;
    }

    output.push(run - 1);
    for (let j = 0; j < run; j += 1) {
      output.push(input[i + j]);
    }
    i += run;
  }

  return new Uint8Array(output);
}

function rleZeroDecode(encoded: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let i = 0;
  let o = 0;

  while (i < encoded.length) {
    const token = encoded[i];
    i += 1;
    const run = (token & 0x7f) + 1;

    if ((token & 0x80) !== 0) {
      out.fill(0, o, o + run);
      o += run;
      continue;
    }

    out.set(encoded.subarray(i, i + run), o);
    i += run;
    o += run;
  }

  return out;
}

function buildCompactionPayload(sequence: number, pages: Array<{ page: number; data: Uint8Array }>): Uint8Array {
  const entries = pages.map((entry) => {
    const encoded = rleZeroEncode(entry.data);
    return { ...entry, encoded };
  });

  const bytes =
    16 +
    entries.reduce((sum, entry) => {
      return sum + 12 + entry.encoded.byteLength;
    }, 0);

  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  setU32(view, 0, COMPACTION_MAGIC);
  setU32(view, 4, sequence);
  setU32(view, 8, entries.length);
  setU32(view, 12, PAGE_SIZE);

  let cursor = 16;
  for (const entry of entries) {
    setU32(view, cursor, entry.page);
    setU32(view, cursor + 4, entry.data.byteLength);
    setU32(view, cursor + 8, entry.encoded.byteLength);
    cursor += 12;

    out.set(entry.encoded, cursor);
    cursor += entry.encoded.byteLength;
  }

  return out;
}

function parseReplayArchive(archive: Uint8Array): ReplayFragment[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const magic = view.getUint32(0, true);
  expect(magic).toBe(REPLAY_MAGIC);

  const count = view.getUint32(8, true);
  let cursor = 16;
  const out: ReplayFragment[] = [];

  for (let i = 0; i < count; i += 1) {
    const seq = view.getUint32(cursor, true);
    const kindCode = view.getUint32(cursor + 4, true);
    const payloadLen = view.getUint32(cursor + 8, true);
    cursor += 12;

    const payload = archive.slice(cursor, cursor + payloadLen);
    cursor += payloadLen;

    out.push({ seq, kindCode, payload });
  }

  return out;
}

function hydrateHeapFromCompaction(targetHeap: Uint8Array, payload: Uint8Array): void {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const magic = view.getUint32(0, true);
  expect(magic).toBe(COMPACTION_MAGIC);

  const pages = view.getUint32(8, true);
  let cursor = 16;

  for (let i = 0; i < pages; i += 1) {
    const pageIndex = view.getUint32(cursor, true);
    const rawLen = view.getUint32(cursor + 4, true);
    const encodedLen = view.getUint32(cursor + 8, true);
    cursor += 12;

    const encoded = payload.subarray(cursor, cursor + encodedLen);
    cursor += encodedLen;

    const raw = rleZeroDecode(encoded, rawLen);
    targetHeap.set(raw, pageIndex * PAGE_SIZE);
  }
}

async function postFragment(
  sessionId: string,
  sequence: number,
  kind: string,
  payload: Uint8Array,
): Promise<Response> {
  return POST(
    new Request("https://nomadic.local/api/snapshot", {
      method: "POST",
      headers: {
        "x-session-id": sessionId,
        "x-seq-id": sequence.toString(),
        "x-payload-kind": kind,
        "content-type": "application/octet-stream",
      },
      body: payload,
    }),
  );
}

describe("Cross-Device Roaming & State Hydration", () => {
  it("buffers out-of-order fragments and replays them in chronological sequence", async () => {
    const sessionId = "roaming-out-of-order";
    await DELETE(new Request(`https://nomadic.local/api/snapshot?sessionId=${sessionId}`, { method: "DELETE" }));

    const payload1 = new Uint8Array([1, 1, 1]);
    const payload2 = new Uint8Array([2, 2, 2]);
    const payload3 = new Uint8Array([3, 3, 3]);

    expect((await postFragment(sessionId, 3, "delta", payload3)).status).toBe(200);
    expect((await postFragment(sessionId, 1, "delta", payload1)).status).toBe(200);
    expect((await postFragment(sessionId, 2, "delta", payload2)).status).toBe(200);

    const replayResponse = await GET(
      new Request(`https://nomadic.local/api/snapshot?sessionId=${sessionId}&mode=replay`),
    );
    expect(replayResponse.status).toBe(200);

    const replay = new Uint8Array(await replayResponse.arrayBuffer());
    const fragments = parseReplayArchive(replay);

    expect(fragments.map((fragment) => fragment.seq)).toEqual([1, 2, 3]);
  });

  it("restores a cold-boot heap byte-for-byte from serialized compaction fragments", async () => {
    const sessionId = "roaming-cold-boot";
    await DELETE(new Request(`https://nomadic.local/api/snapshot?sessionId=${sessionId}`, { method: "DELETE" }));

    const pageCount = 6;
    const originalHeap = new Uint8Array(pageCount * PAGE_SIZE);

    for (let i = 0; i < PAGE_SIZE; i += 137) {
      originalHeap[i] = (i * 17) & 0xff;
      originalHeap[PAGE_SIZE * 2 + i] = (255 - i) & 0xff;
      originalHeap[PAGE_SIZE * 5 + i] = (i * 7) & 0xff;
    }

    const payload = buildCompactionPayload(41, [
      { page: 0, data: originalHeap.slice(PAGE_SIZE * 0, PAGE_SIZE * 1) },
      { page: 2, data: originalHeap.slice(PAGE_SIZE * 2, PAGE_SIZE * 3) },
      { page: 5, data: originalHeap.slice(PAGE_SIZE * 5, PAGE_SIZE * 6) },
    ]);

    expect((await postFragment(sessionId, 41, "compacted", payload)).status).toBe(200);

    const replayResponse = await GET(
      new Request(`https://nomadic.local/api/snapshot?sessionId=${sessionId}&mode=replay`),
    );
    expect(replayResponse.status).toBe(200);

    const replay = new Uint8Array(await replayResponse.arrayBuffer());
    const fragments = parseReplayArchive(replay);

    const hydratedHeap = new Uint8Array(originalHeap.length);
    for (const fragment of fragments) {
      if (fragment.kindCode === 2) {
        hydrateHeapFromCompaction(hydratedHeap, fragment.payload);
      }
    }

    expect(Array.from(hydratedHeap)).toEqual(Array.from(originalHeap));
  });
});
