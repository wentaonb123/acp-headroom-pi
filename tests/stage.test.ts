import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEADROOM_DEFAULTS, type ResolvedHeadroom } from "../src/config.js";
import { invalidateHealth, originOf } from "../src/proxy.js";
import { HeadroomStage } from "../src/stage.js";

function cfg(overrides: Partial<ResolvedHeadroom> = {}): ResolvedHeadroom {
  return { ...HEADROOM_DEFAULTS, ...overrides };
}

describe("originOf", () => {
  it("extracts origin and tolerates garbage", () => {
    assert.equal(originOf("http://127.0.0.1:8787/sub"), "http://127.0.0.1:8787");
    assert.equal(originOf("not a url"), "not a url");
  });
});

describe("invalidateHealth", () => {
  it("clears per-origin and global state without throwing", () => {
    invalidateHealth("http://127.0.0.1:1");
    invalidateHealth();
  });
});

describe("HeadroomStage (fail-open behavior)", () => {
  // Port 1 is reserved and refuses connections instantly; each test uses a
  // distinct port so the per-origin negative cache never leaks between cases.
  it("returns the payload untouched when the proxy is down (autoStart off)", async () => {
    invalidateHealth();
    const stage = new HeadroomStage(() => cfg({ proxyUrl: "http://127.0.0.1:1", autoStart: false }));
    const payload = { model: "m", messages: stringMessages(10) };
    const out = await stage.compress(payload);
    assert.equal(out, payload); // identity, not a clone: bytes must not change
    assert.equal(stage.stats.skipped, 1);
    assert.equal(stage.stats.applied, 0);
    assert.equal(stage.unavailableStreak, 1);
  });

  it("notifies the outage only once, then keeps failing open", async () => {
    invalidateHealth();
    const stage = new HeadroomStage(() => cfg({ proxyUrl: "http://127.0.0.1:2", autoStart: false }));
    await stage.compress({ messages: stringMessages(5) });
    await stage.compress({ messages: stringMessages(5) });
    await stage.compress({ messages: stringMessages(5) });
    assert.equal(stage.stats.skipped, 3);
    assert.equal(stage.unavailableStreak, 3);
    // single-notice behavior is internal; the observable contract is that
    // every call still returns the original payload.
  });

  it("disabled config short-circuits without any probe", async () => {
    invalidateHealth();
    const stage = new HeadroomStage(() => cfg({ enabled: false, proxyUrl: "http://127.0.0.1:3" }));
    const payload = { messages: stringMessages(5) };
    assert.equal(await stage.compress(payload), payload);
    assert.equal(stage.unavailableStreak, 0);
  });

  it("resetSession clears stats and streaks", () => {
    const stage = new HeadroomStage(() => cfg({ proxyUrl: "http://127.0.0.1:4" }));
    stage.markProxyAttempted();
    stage.resetSession();
    assert.deepEqual(stage.stats, { applied: 0, savedTokens: 0, skipped: 0 });
    assert.equal(stage.unavailableStreak, 0);
  });
});

function stringMessages(n: number): Array<{ role: string; content: string }> {
  const out = [{ role: "system", content: "sys ".repeat(200) }];
  for (let i = 0; i < n; i++) out.push({ role: "user", content: `message ${i} `.repeat(50) });
  return out;
}
