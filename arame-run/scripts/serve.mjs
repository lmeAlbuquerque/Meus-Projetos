import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publicConfigScript, readPublicSupabaseConfig } from "./public-config.mjs";

const root = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const publicConfig = readPublicSupabaseConfig(process.env);
const port = Number(process.env.ARAME_RUN_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("ARAME_RUN_PORT must be an integer between 1024 and 65535.");
}
if (!publicConfig.supabaseUrl) {
  console.warn("Supabase is not configured. Copy .env.example to .env and set SUPABASE_URL and SUPABASE_ANON_KEY.");
}
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/config.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://*.supabase.co http://127.0.0.1:54321 http://localhost:54321; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      }).end(publicConfigScript(publicConfig));
      return;
    }
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://*.supabase.co http://127.0.0.1:54321 http://localhost:54321; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    }).end(content);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Arame RUN: http://localhost:${port}`);
});
