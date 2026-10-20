import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";

const esperado = (process.env.ATA_EDITOR_TOKEN || "").trim();

function confere(recebido) {
  if (!esperado || !recebido) return false;
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(String(recebido).trim()).digest();
  return timingSafeEqual(a, b);
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/validar") {
      res.writeHead(404);
      res.end();
      return;
    }
    const ok = confere(req.headers["x-ata-token"]);
    if (ok) {
      res.writeHead(204);
      res.end();
      return;
    }
    setTimeout(() => {
      res.writeHead(403);
      res.end();
    }, 300);
  })
  .listen(8081, "127.0.0.1");
