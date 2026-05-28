"use client";

import { useCallback, useRef, useState } from "react";

type APKInstallerProps = {
  onInstallRequest: (packageName: string, vfsPath: string) => void;
};

function sanitizePackageName(name: string): string {
  const raw = name.replace(/\.apk$/i, "");
  const safe = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safe.length > 0 ? safe : "android-app";
}

export default function APKInstaller({ onInstallRequest }: APKInstallerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const processApk = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".apk")) {
        setStatus("Only .apk packages are accepted.");
        return;
      }

      const packageName = sanitizePackageName(file.name);
      const vfsPath = `/data/app/${packageName}/base.apk`;
      setStatus(`Staging ${file.name} into OPFS and preparing kernel deployment...`);

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const rootDir = await navigator.storage.getDirectory();
        const staging = await rootDir.getFileHandle(`${packageName}.apk`, { create: true });
        const writer = await staging.createWritable();
        await writer.write(bytes);
        await writer.close();

        onInstallRequest(packageName, vfsPath);
        setStatus(`Kernel deployment requested: ${packageName}`);
      } catch (error) {
        setStatus(`Deployment crash: ${String(error)}`);
      }
    },
    [onInstallRequest],
  );

  return (
    <section className="apk-installer" aria-label="APK installer">
      <header>
        <h2>ANR APK Installer</h2>
        <p>Drop Android packages here to stage and deploy into /data/app mount points.</p>
      </header>

      <div
        className={`apk-drop-zone ${isDragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) {
            void processApk(file);
          }
        }}
      >
        <p>Drop .apk package</p>
        <button
          type="button"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          Browse APK
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".apk"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void processApk(file);
          }
          event.target.value = "";
        }}
      />

      {status ? <p className="apk-status">{status}</p> : null}
    </section>
  );
}
