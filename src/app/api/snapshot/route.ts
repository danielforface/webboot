type SnapshotFragment = {
  seq: number;
  kind: string;
  payload: Uint8Array;
  updatedAt: number;
};

type SnapshotSession = {
  updatedAt: number;
  fragments: SnapshotFragment[];
  totalBytes: number;
};

type SnapshotStore = Map<string, SnapshotSession>;

declare global {
  var __everywhereSnapshotStore: SnapshotStore | undefined;
}

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_FRAGMENT_COUNT = 2048;
const MAX_SESSION_BYTES = 256 * 1024 * 1024;
const REPLAY_MAGIC = 0x3156_4c52;

function kindToCode(kind: string): number {
  if (kind === "manifest") {
    return 1;
  }

  if (kind === "compacted") {
    return 2;
  }

  if (kind === "delta") {
    return 3;
  }

  return 0;
}

function pushU32(target: Uint8Array, offset: number, value: number): number {
  target[offset + 0] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
  return offset + 4;
}

function buildReplayArchive(fragments: SnapshotFragment[]): Uint8Array {
  const payloadBytes = fragments.reduce((sum, fragment) => sum + 12 + fragment.payload.byteLength, 0);
  const output = new Uint8Array(16 + payloadBytes);

  let cursor = 0;
  cursor = pushU32(output, cursor, REPLAY_MAGIC);
  cursor = pushU32(output, cursor, 1);
  cursor = pushU32(output, cursor, fragments.length);
  cursor = pushU32(output, cursor, 0);

  for (const fragment of fragments) {
    cursor = pushU32(output, cursor, fragment.seq >>> 0);
    cursor = pushU32(output, cursor, kindToCode(fragment.kind));
    cursor = pushU32(output, cursor, fragment.payload.byteLength >>> 0);
    output.set(fragment.payload, cursor);
    cursor += fragment.payload.byteLength;
  }

  return output;
}

function getStore(): SnapshotStore {
  if (!globalThis.__everywhereSnapshotStore) {
    globalThis.__everywhereSnapshotStore = new Map();
  }

  return globalThis.__everywhereSnapshotStore;
}

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const sessionId = request.headers.get("x-session-id") ?? "default";
  const kind = request.headers.get("x-payload-kind") ?? "delta";
  const seqHeader = request.headers.get("x-seq-id") ?? "0";
  const seq = Number.parseInt(seqHeader, 10);
  const payload = new Uint8Array(await request.arrayBuffer());

  if (payload.byteLength === 0 || payload.byteLength > MAX_PAYLOAD_BYTES) {
    return new Response("Invalid snapshot payload", { status: 400 });
  }

  if (!Number.isFinite(seq) || seq < 0) {
    return new Response("Invalid sequence id", { status: 400 });
  }

  const store = getStore();
  const session =
    store.get(sessionId) ??
    {
      updatedAt: Date.now(),
      fragments: [],
      totalBytes: 0,
    };

  const existing = session.fragments.find((fragment) => fragment.seq === seq);
  if (existing) {
    session.totalBytes -= existing.payload.byteLength;
    existing.payload = payload;
    existing.kind = kind;
    existing.updatedAt = Date.now();
    session.totalBytes += payload.byteLength;
  } else {
    session.fragments.push({
      seq,
      kind,
      payload,
      updatedAt: Date.now(),
    });
    session.totalBytes += payload.byteLength;
  }

  session.fragments.sort((a, b) => a.seq - b.seq);

  while (session.fragments.length > MAX_FRAGMENT_COUNT || session.totalBytes > MAX_SESSION_BYTES) {
    const dropped = session.fragments.shift();
    if (!dropped) {
      break;
    }

    session.totalBytes -= dropped.payload.byteLength;
  }

  session.updatedAt = Date.now();
  store.set(sessionId, session);

  return new Response(
    JSON.stringify({
      ok: true,
      sessionId,
      seq,
      kind,
      bytes: payload.byteLength,
      fragments: session.fragments.length,
      totalBytes: session.totalBytes,
      updatedAt: session.updatedAt,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? "default";
  const mode = url.searchParams.get("mode") ?? "replay";

  const store = getStore();
  const session = store.get(sessionId);
  if (!session || session.fragments.length === 0) {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  if (mode === "meta") {
    const latest = session.fragments[session.fragments.length - 1];
    return new Response(
      JSON.stringify({
        sessionId,
        updatedAt: session.updatedAt,
        fragments: session.fragments.length,
        totalBytes: session.totalBytes,
        latestSeq: latest?.seq ?? 0,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }

  if (mode === "latest") {
    const latest = session.fragments[session.fragments.length - 1];
    return new Response(latest.payload, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "x-snapshot-kind": latest.kind,
        "x-snapshot-seq": latest.seq.toString(),
        "x-snapshot-updated": latest.updatedAt.toString(),
        "cache-control": "no-store",
      },
    });
  }

  const archive = buildReplayArchive(session.fragments);
  return new Response(archive, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "x-snapshot-fragments": session.fragments.length.toString(),
      "x-snapshot-updated": session.updatedAt.toString(),
      "cache-control": "no-store",
    },
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? "default";

  const store = getStore();
  const existed = store.delete(sessionId);

  return new Response(
    JSON.stringify({
      ok: true,
      sessionId,
      cleared: existed,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
