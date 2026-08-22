import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { proxyHealthy, invalidateHealth } from "../src/headroom/client.js";

/** /health fails the first `failTimes` requests, then succeeds. */
function startFlakyProxy(failTimes: number): Promise<{ url: string; close: () => Promise<void>; hits: () => number }> {
	let hits = 0;
	const server: Server = createServer((_req, res) => {
		hits += 1;
		if (hits <= failTimes) {
			res.destroy(); // connection-level failure, like an abort mid-request
			return;
		}
		res.writeHead(200);
		res.end("ok");
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

beforeEach(() => invalidateHealth());

after(() => invalidateHealth());

test("a single failed probe is retried — transient blips never flip the state", async () => {
	const proxy = await startFlakyProxy(1);
	try {
		assert.equal(await proxyHealthy(proxy.url), true);
		assert.equal(proxy.hits(), 2, "first hit destroyed, second answered");
	} finally {
		await proxy.close();
	}
});

test("positive result is cached — repeat calls do not re-probe", async () => {
	const proxy = await startFlakyProxy(0);
	try {
		assert.equal(await proxyHealthy(proxy.url), true);
		assert.equal(await proxyHealthy(proxy.url), true);
		assert.equal(proxy.hits(), 1);
	} finally {
		await proxy.close();
	}
});

test("confirmed outage negatively caches — subsequent rounds fail fast without probing", async () => {
	const proxy = await startFlakyProxy(Number.MAX_SAFE_INTEGER);
	try {
		assert.equal(await proxyHealthy(proxy.url), false);
		assert.equal(proxy.hits(), 2, "double probe on first check");
		assert.equal(await proxyHealthy(proxy.url), false, "negative cache answers instantly");
		assert.equal(await proxyHealthy(proxy.url), false);
		assert.equal(proxy.hits(), 2, "no re-probe while negatively cached");
	} finally {
		await proxy.close();
	}
});

test("invalidateHealth clears both caches", async () => {
	const dead = "http://127.0.0.1:9";
	assert.equal(await proxyHealthy(dead), false);
	invalidateHealth();
	const proxy = await startFlakyProxy(0);
	try {
		assert.equal(await proxyHealthy(proxy.url), true, "fresh probes after invalidation");
	} finally {
		await proxy.close();
	}
});

test("health verdicts are keyed per origin — one outage never poisons another URL", async () => {
	const down = await startFlakyProxy(Number.MAX_SAFE_INTEGER);
	const up = await startFlakyProxy(0);
	try {
		assert.equal(await proxyHealthy(down.url), false, "origin A confirmed down");
		assert.equal(await proxyHealthy(up.url), true, "origin B probed independently, unaffected by A's negative cache");
		assert.equal(await proxyHealthy(down.url), false);
	} finally {
		await Promise.all([down.close(), up.close()]);
	}
});
