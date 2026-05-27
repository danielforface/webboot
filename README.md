# WebBoot

WebBoot is a blueprint project for a WebAssembly-native, single-address-space OS runtime
hosted inside a Next.js application.

## Quick Start

```bash
npm install
npm run dev
```

## Build Kernel

```bash
cargo build --manifest-path os-kernel/Cargo.toml --target wasm32-unknown-unknown --release
```

Copy the generated wasm to public/wasm/os-kernel.wasm and refresh the app.

## Design Specification

See docs/architecture.md for the full system architecture, constraints, and boot pipeline.
