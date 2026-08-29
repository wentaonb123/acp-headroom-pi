// Smoke test: rolling budget in HeadroomStage
// Candidates A(1000ch, compressible), B(900ch, compressible), C(800ch, below-gain), D(700ch, compressible)
// maxPerTurn=2 -> round1 compresses A+B (2 requests, C/D break). round2: A/B cache-hit (0 req),
// C no-gain-known (0 req), D requested (1 req) => rolling works, 3 applied total, 3 requests total.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { HeadroomStage } from "../src/headroom/stage.js";
import type { AdapterConfig } from "../src/config.js";

function makeText(n: number, seed: string): string {
  return `${seed} ${"word ".repeat(n / 6)}`.slice(0, n);
}

test("rolling budget compresses past known no-gain candidates across rounds", async () => {
  let compressCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      compressCalls += 1;
      const parsed = JSON.parse(body);
      const text = parsed.messages[1].content;
      res.writeHead(200, { "content-type": "application/json" });
      if (text.startsWith("C ")) {
        // below-gain: echo back (no compression possible)
        res.end(JSON.stringify({ messages: [{ role: "tool", content: text }], tokens_before: 10, tokens_after: 10, ccr_hashes: [] }));
        return;
      }
      res.end(JSON.stringify({ messages: [{ role: "tool", content: `${text.slice(0, 20)} [Retrieve more: hash=ab12cd34ef56]` }], tokens_before: 100, tokens_after: 5, ccr_hashes: ["ab12cd34ef56"] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const adapter: AdapterConfig = {
    headroom: { enabled: true, proxyUrl: `http://127.0.0.1:${port}`, autoStart: false, minChars: 100, maxPerTurn: 2, timeoutMs: 2000 },
  };
  const stage = new HeadroomStage(() => adapter);
  const mk = (id: string, text: string) => ({ id, role: "tool" as const, toolName: "bash", text });
  const msgs = [
    mk("m1", makeText(1000, "A ")),
    mk("m2", makeText(900, "B ")),
    mk("m3", makeText(800, "C ")),
    mk("m4", makeText(700, "D ")),
    { id: "u1", role: "user" as const, text: "last user" },
  ];

  const r1 = await stage.apply(msgs, "test-model");
  assert.equal(r1.applied, 2, "round1 compresses the top-2 (budget 2)");
  assert.equal(r1.replacements.has("m1"), true);
  assert.equal(r1.replacements.has("m4"), false, "D is beyond round1 budget");

  const r2 = await stage.apply(msgs, "test-model");
  assert.equal(r2.applied, 3, "round2 replaces A/B (cache hits count) + D (rolled in past known no-gain C)");
  assert.equal(r2.replacements.has("m4"), true, "rolling budget reaches candidate #4");
  assert.equal(r2.replacements.has("m3"), false, "no-gain C never replaced");
  assert.equal(stage.stats.applied, 5, "cumulative applied");
  assert.ok(stage.stats.savedTokens > 0, "cumulative savedTokens");
  assert.equal(compressCalls, 4, `round1: A+B (2 req, C cut by budget); round2: A/B cached, C first-seen no-gain (1 req), D rolled in (1 req) => 4 total`);
  server.closeAllConnections();
  server.close();
});