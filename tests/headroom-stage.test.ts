import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadroomStage } from "../src/headroom/stage.js";
import { invalidateHealth } from "../src/headroom/client.js";
import type { AdapterConfig } from "../src/config.js";

const HASH = "a1b2c3d4e5f6a1b2c3d4e5f6";
const COMPRESSED = `[headroom hash=${HASH}]\nCOMPRESSED SUMMARY\n<<ccr:${HASH},text,100>>`;

interface FakeProxy {
	url: string;
	close: () => Promise<void>;
	compressHits: () => number;
	lastBody: () => unknown;
}

/** Minimal stand-in for the Headroom proxy: /health + /v1/compress only. */
function startFakeProxy(opts: { status?: number; compressed?: string; tokens?: [number, number] } = {}): Promise<FakeProxy> {
	let compressHits = 0;
	let lastBody: unknown;
	const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.url === "/health") {
			res.writeHead(200);
			res.end("ok");
			return;
		}
		if (req.url === "/v1/compress" && req.method === "POST") {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				compressHits += 1;
				lastBody = JSON.parse(body);
				if (opts.status && opts.status !== 200) {
					res.writeHead(opts.status);
					res.end("{}");
					return;
				}
				const parsed = lastBody as { messages: Array<{ content: string }> };
				const original = parsed.messages[parsed.messages.length - 1].content as string;
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({
					messages: [{ role: "assistant" }, { role: "tool", tool_call_id: "call_headroom_pi", content: opts.compressed ?? COMPRESSED }],
					tokens_before: opts.tokens?.[0] ?? Math.ceil(original.length / 4),
					tokens_after: opts.tokens?.[1] ?? Math.ceil(COMPRESSED.length / 4),
					compression_ratio: 0.2,
					transforms_applied: ["smart_crusher"],
					ccr_hashes: [HASH],
				}));
			});
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
				compressHits: () => compressHits,
				lastBody: () => lastBody,
			});
		});
	});
}

function stage(proxyUrl: string, extra: AdapterConfig["headroom"] = {}): HeadroomStage {
	return new HeadroomStage(() => ({ headroom: { proxyUrl, autoStart: false, ...extra } }));
}

function bigText(lines = 400): string {
	return Array.from({ length: lines }, (_, i) => `line ${i}: some verbose tool output payload data`).join("\n");
}

type Msg = { id: string; role: "user" | "assistant" | "tool"; text: string; toolName?: string };

function msg(id: string, role: Msg["role"], text: string, toolName?: string): Msg {
	return { id, role, text, toolName };
}

let ccrTmp: string;

beforeEach(() => {
	invalidateHealth();
	if (!ccrTmp) ccrTmp = mkdtempSync(join(tmpdir(), "acp-headroom-test-"));
	process.env.HEADROOM_CCR_DIR = ccrTmp;
});

after(() => {
	delete process.env.HEADROOM_CCR_DIR;
	try { rmSync(ccrTmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("stage compresses an oversized past-turn tool result end to end", async () => {
	const proxy = await startFakeProxy();
	try {
		const s = stage(proxy.url);
		const messages: Msg[] = [
			msg("t1", "tool", bigText(), "bash"),
			msg("u1", "user", "next question"),
		];
		const result = await s.apply(messages, "test-model");
		assert.equal(result.applied, 1);
		assert.equal(result.replacements.get("t1"), COMPRESSED);
		assert.ok(result.available);
		assert.ok(result.savedTokens > 0);
		assert.equal(s.stats.applied, 1);
		// The synthetic OpenAI pair reached the proxy with the right shape.
		const body = proxy.lastBody() as { messages: Array<{ role: string; content?: string }>; config: Record<string, unknown>; model: string };
		assert.equal(body.config.mode, "ccr");
		assert.equal(body.config.protect_recent, 0);
		assert.equal(body.model, "test-model");
		assert.equal(body.messages[1].content, messages[0].text);
		// CCR backup written to the temp dir.
		const backup = join(process.env.HEADROOM_CCR_DIR!, `${HASH}.txt`);
		assert.ok(existsSync(backup));
		assert.equal(readFileSync(backup, "utf8"), messages[0].text);
	} finally {
		await proxy.close();
	}
});

test("stage skips small results, protected tools, current-turn results, and already-marked text", async () => {
	const proxy = await startFakeProxy();
	try {
		const s = stage(proxy.url);
		const messages: Msg[] = [
			msg("s1", "tool", "tiny", "bash"), // below minChars
			msg("p1", "tool", bigText(), "decompress"), // protected tool
			msg("m1", "tool", `Retrieve more: hash=${HASH}\n${bigText()}`, "bash"), // already marked
			msg("ok1", "tool", bigText(), "read"),
			msg("u0", "user", "earlier question"),
			msg("c1", "tool", bigText(), "bash"), // current turn (after the last user message)
		];
		const result = await s.apply(messages, "m");
		assert.equal(result.applied, 1);
		assert.equal([...result.replacements.keys()][0], "ok1");
		assert.equal(proxy.compressHits(), 1);
	} finally {
		await proxy.close();
	}
});

test("stage caches by content hash — a second identical result does not hit the proxy again", async () => {
	const proxy = await startFakeProxy();
	try {
		const s = stage(proxy.url);
		const mk = (id: string): Msg[] => [msg(id, "tool", bigText(), "bash"), msg(`${id}-u`, "user", "q")];
		const first = await s.apply(mk("a"), "m");
		assert.equal(first.applied, 1);
		const second = await s.apply(mk("b"), "m");
		assert.equal(second.applied, 1);
		assert.equal(proxy.compressHits(), 1, "cache must absorb the second identical payload");
	} finally {
		await proxy.close();
	}
});

test("maxPerTurn budget compresses only the largest results", async () => {
	const proxy = await startFakeProxy({ tokens: [10_000, 20] });
	try {
		const s = stage(proxy.url, { maxPerTurn: 2, minChars: 100 });
		const messages: Msg[] = [
			msg("big1", "tool", bigText(600), "bash"),
			msg("big2", "tool", bigText(500), "read"),
			msg("small3", "tool", bigText(50), "grep"),
			msg("small4", "tool", bigText(40), "find"),
			msg("u1", "user", "go"),
		];
		const result = await s.apply(messages, "m");
		assert.deepEqual([...result.replacements.keys()].sort(), ["big1", "big2"]);
	} finally {
		await proxy.close();
	}
});

test("fail-open on HTTP error and on no-gain compression", async () => {
	const erroring = await startFakeProxy({ status: 500 });
	try {
		const s = stage(erroring.url);
		const result = await s.apply([msg("t", "tool", bigText(), "bash"), msg("u", "user", "q")], "m");
		assert.equal(result.applied, 0);
		assert.ok(result.available, "HTTP error still means the proxy is reachable");
	} finally {
		await erroring.close();
	}
	const wasteful = await startFakeProxy({ compressed: `x`.repeat(bigText().length + 10) });
	try {
		const s = stage(wasteful.url);
		const result = await s.apply([msg("t", "tool", bigText(), "bash"), msg("u", "user", "q")], "m");
		assert.equal(result.applied, 0, "compression that grows the text must be discarded");
	} finally {
		await wasteful.close();
	}
});

test("unreachable proxy degrades to pass-through and stays unavailable", async () => {
	const prev = process.env.HEADROOM_PROXY_URL;
	delete process.env.HEADROOM_PROXY_URL;
	invalidateHealth();
	try {
		const s = stage("http://127.0.0.1:9"); // nothing listens here
		const first = await s.apply([msg("t", "tool", bigText(), "bash"), msg("u", "user", "q")], "m");
		assert.equal(first.applied, 0);
		assert.equal(first.available, false);
		const second = await s.apply([msg("t2", "tool", bigText(), "bash"), msg("u2", "user", "q")], "m");
		assert.equal(second.available, false, "still unavailable on the next round");
	} finally {
		if (prev !== undefined) process.env.HEADROOM_PROXY_URL = prev;
	}
});

test("disabled config short-circuits without touching the network", async () => {
	const s = new HeadroomStage(() => ({ headroom: false }));
	const result = await s.apply([msg("t", "tool", bigText(), "bash"), msg("u", "user", "q")], "m");
	assert.equal(result.applied, 0);
	assert.equal(result.available, true);
});

test("caller substitution shrinks the message view (index.ts contract)", async () => {
	const proxy = await startFakeProxy();
	try {
		const s = stage(proxy.url);
		const messages: Msg[] = [msg("t1", "tool", bigText(), "bash"), msg("u1", "user", "q")];
		const before = messages[0].text.length;
		const result = await s.apply(messages, "m");
		for (const m of messages) {
			const t = result.replacements.get(m.id);
			if (t !== undefined && typeof m.text === "string") m.text = t;
		}
		assert.ok(messages[0].text.length < before / 2);
		assert.ok(messages[0].text.includes(HASH));
	} finally {
		await proxy.close();
	}
});
