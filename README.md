# WebBoot

WebBoot hosts the Everywhere Nomadic OS scaffold: a browser-native runtime with
shared-memory wasm execution, dirty-page delta sync, and instant session roaming.

## Quick Start

```bash
npm install
npm run dev
```

## Build Kernel

```bash
cargo build --manifest-path os-kernel/Cargo.toml --target wasm32-unknown-unknown --release
```

Copy the generated wasm to public/wasm/core-os.wasm and refresh the app.

## Design Specification

See docs/framework-spec.md for the full system architecture, constraints, and boot pipeline.
