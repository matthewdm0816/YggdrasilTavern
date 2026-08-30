import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendOrigin = process.env.YGGDRASIL_BACKEND_ORIGIN ?? "http://127.0.0.1:8000";
const certificateFile = process.env.YGGDRASIL_HTTPS_CERT_FILE;
const privateKeyFile = process.env.YGGDRASIL_HTTPS_KEY_FILE;

if (Boolean(certificateFile) !== Boolean(privateKeyFile)) {
  throw new Error("HTTPS requires both YGGDRASIL_HTTPS_CERT_FILE and YGGDRASIL_HTTPS_KEY_FILE");
}

const backendUrl = new URL(backendOrigin);
if (!(["http:", "https:"] as string[]).includes(backendUrl.protocol)) {
  throw new Error(`Unsupported backend proxy scheme: ${backendUrl.protocol}`);
}

const https = certificateFile && privateKeyFile
  ? {
      cert: readFileSync(certificateFile),
      key: readFileSync(privateKeyFile)
    }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    https,
    proxy: {
      "/api": {
        target: backendUrl.origin,
        changeOrigin: false
      }
    }
  }
});
