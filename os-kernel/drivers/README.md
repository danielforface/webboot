# Drivers

Each driver is designed as an independently versioned WASM component that is loaded by the
kernel bootloader from OPFS and linked through WIT-defined imports/exports.

## Planned Components

- storage/: OPFS-backed block device and metadata journal.
- gpu/: WebGPU queue/command submission path with WGSL pipelines.
- net/: WebTransport/WebRTC data channel socket runtime.

In production, each component should expose a WIT package and be assembled with
wit-component and wasm-tools into the runtime graph.
