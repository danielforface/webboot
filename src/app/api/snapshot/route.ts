type SnapshotRecord = {
  payload: Uint8Array;
  updatedAt: number;
  kind: string;
};

type SnapshotStore = Map<string, SnapshotRecord>;

declare global {
  var __everywhereSnapshotStore: SnapshotStore | undefined;
}

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

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
  const payload = new Uint8Array(await request.arrayBuffer());

  if (payload.byteLength === 0 || payload.byteLength > MAX_PAYLOAD_BYTES) {
    return new Response("Invalid snapshot payload", { status: 400 });
  }

  const store = getStore();
  store.set(sessionId, {
    payload,
    updatedAt: Date.now(),
    kind,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      sessionId,
      kind,
      bytes: payload.byteLength,
      updatedAt: Date.now(),
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

  const store = getStore();
  const record = store.get(sessionId);
  if (!record) {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  return new Response(record.payload, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "x-snapshot-kind": record.kind,
      "x-snapshot-updated": record.updatedAt.toString(),
      "cache-control": "no-store",
    },
  });
}
