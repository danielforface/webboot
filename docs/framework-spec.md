# Everywhere Nomadic OS Framework Specification

## 1. Runtime Objective

The Everywhere OS runtime is a browser-native operating system shell that keeps active session state portable across devices by combining:

- WebAssembly shared linear memory
- lock-free dirty page tracking
- differential page synchronization through a Next.js snapshot API
- deterministic resume semantics in a worker-hosted kernel loop

The Next.js app is constrained to rendering and sync transport only.

## 2. Production Structure

```text
.
├── os-kernel/
│   ├── Cargo.toml
│   ├── .cargo/config.toml
│   ├── wit/
│   │   └── core-os.wit
│   └── src/
│       ├── main.rs
│       ├── memory.rs
│       ├── vfs.rs
│       └── window_manager.rs
├── src/
│   ├── app/
│   │   ├── api/snapshot/route.ts
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── OsTerminal.tsx
│   │   └── SpatialDisplay.tsx
│   └── workers/
│       └── core-worker.ts
└── docs/
    └── framework-spec.md
```

## 3. Memory and Delta Protocol

### Page model

- Kernel pages are fixed at 64 KiB.
- Dirty-page state is stored in an `AtomicU8` bitmap (`memory.rs`).
- Writes call `mark_page` or `mark_range` to flag modified pages.

### Delta packet format

Little-endian wire format used between worker and snapshot route:

1. `u32 magic` = `0x444d4f4e` (`NOMD`)
2. `u32 version` = `1`
3. `u32 page_count`
4. repeated records:
   - `u32 page_index`
   - `u32 byte_length` (currently 65536)
   - `byte_length` bytes of page payload

This avoids object serialization and keeps transfer in a compact binary form.

## 4. Suspend and Resume Semantics

### Suspend path

1. `os_suspend()` marks kernel state suspended.
2. VFS block-delta tracker emits a compact manifest payload.
3. Host callback `host_sync` pushes the manifest to `/api/snapshot`.
4. Worker flushes any pending dirty pages through the delta packet stream.

### Resume path

1. Worker fetches latest snapshot blob for the authenticated session.
2. Worker applies each page through `os_write_page`.
3. Worker writes the session token into wasm memory and calls `os_resume`.
4. Kernel returns to normal `os_poll` loop.

## 5. Input and Render Contracts

- Input from keyboard, pointer, and wheel is funneled into `os_process_input`.
- `window_manager.rs` uses a lockless ring for sub-millisecond event intake.
- `os_get_render_tree` returns packed `WindowNode` structs.
- UI consumes render nodes through `SpatialDisplay` and never owns internal app logic.

## 6. Build and Run

1. Build wasm kernel:

```bash
cargo build --manifest-path os-kernel/Cargo.toml --target wasm32-unknown-unknown --release
```

2. Copy artifact:

```bash
copy os-kernel\target\wasm32-unknown-unknown\release\os-kernel.wasm public\wasm\core-os.wasm
```

3. Start app:

```bash
npm install
npm run dev
```

## 7. Required Runtime Headers

`next.config.js` must include:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

These headers are required for SharedArrayBuffer and wasm atomics.
