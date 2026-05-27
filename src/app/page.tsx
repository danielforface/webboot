import OsViewport from "@/components/OsViewport";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="shell-header">
        <p className="eyebrow">WASM Component Model SASOS</p>
        <h1>WebBoot Control Surface</h1>
        <p className="summary">
          React acts only as a monitor and pixel viewport. The bootloader, scheduler,
          and ring-buffer IPC execute in shared WebAssembly memory inside worker
          runtimes.
        </p>
      </header>
      <OsViewport />
    </main>
  );
}
