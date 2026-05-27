Place the compiled kernel binary here as os-kernel.wasm.

Expected command (from repository root):

cargo build --manifest-path os-kernel/Cargo.toml --target wasm32-unknown-unknown --release

Then copy:

os-kernel/target/wasm32-unknown-unknown/release/os-kernel.wasm

into this directory as:

public/wasm/os-kernel.wasm
