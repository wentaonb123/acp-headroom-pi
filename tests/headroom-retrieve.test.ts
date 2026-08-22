import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieveOriginal, saveOriginals } from "../src/headroom/client.js";

const HASH = "a1b2c3d4e5f6a1b2c3d4e5f6";

/** Serves the REAL /v1/retrieve response shape (server.py ccr_retrieve_get). */
function startFakeProxy(original: string): Promise<{ url: string; close: () => Promise<void>; hits: () => number }> {
	let hits = 0;
	const server: Server = createServer((req, res) => {
		if (req.url === `/v1/retrieve/${HASH}`) {
			hits += 1;
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({
				hash: HASH,
				original_content: original,
				original_tokens: Math.ceil(original.length / 4),
				original_item_count: 42,
				compressed_item_count: 3,
				tool_name: "bash",
				retrieval_count: 1,
			}));
			return;
		}
		res.writeHead(404);
		res.end();
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as { port: number };
			resolve({
				url: `http://127.0.0.1:${addr.port}`,
				close: () => new Promise<void>((done) => server.close(() => done())),
				hits: () => hits,
			});
		});
	});
}

let ccrTmp: string;

beforeEach(() => {
	if (!ccrTmp) ccrTmp = mkdtempSync(join(tmpdir(), "acp-headroom-retrieve-"));
	process.env.HEADROOM_CCR_DIR = ccrTmp;
});

after(() => {
	delete process.env.HEADROOM_CCR_DIR;
	try { rmSync(ccrTmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("retrieveOriginal parses the proxy's original_content field", async () => {
	const proxy = await startFakeProxy("ORIGINAL PAYLOAD TEXT");
	try {
		const out = await retrieveOriginal(proxy.url, HASH);
		assert.equal(out, "ORIGINAL PAYLOAD TEXT");
		assert.equal(proxy.hits(), 1);
	} finally {
		await proxy.close();
	}
});

test("local disk backup wins over the proxy and works while the proxy is down", async () => {
	await saveOriginals([HASH], "LOCAL BACKUP COPY");
	const out = await retrieveOriginal("http://127.0.0.1:9", HASH); // proxy unreachable
	assert.equal(out, "LOCAL BACKUP COPY");
});

test("invalid hash and unreachable proxy both return null", async () => {
	assert.equal(await retrieveOriginal("http://127.0.0.1:9", "not-a-hash"), null);
	const miss = await startFakeProxy("x");
	try {
		assert.equal(await retrieveOriginal(miss.url, "000000000000000000000000"), null);
	} finally {
		await miss.close();
	}
});
