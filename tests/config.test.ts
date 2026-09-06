import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEADROOM_DEFAULTS, resolveHeadroom } from "../src/config.js";

describe("resolveHeadroom", () => {
  it("returns defaults for empty config", () => {
    const r = resolveHeadroom(undefined);
    assert.deepEqual(
      { ...r, proxyUrl: r.proxyUrl },
      { ...HEADROOM_DEFAULTS, proxyUrl: HEADROOM_DEFAULTS.proxyUrl },
    );
  });

  it("false disables the stage", () => {
    assert.equal(resolveHeadroom(false).enabled, false);
  });

  it("env HEADROOM_PROXY_URL wins over config", () => {
    process.env.HEADROOM_PROXY_URL = "http://127.0.0.1:9999/";
    try {
      const r = resolveHeadroom({ proxyUrl: "http://127.0.0.1:8787" });
      assert.equal(r.proxyUrl, "http://127.0.0.1:9999"); // trailing slash stripped
    } finally {
      delete process.env.HEADROOM_PROXY_URL;
    }
  });

  it("rejects invalid values and keeps defaults", () => {
    const r = resolveHeadroom({
      mode: "bogus",
      minMessages: -3,
      minPayloadChars: "x",
      timeoutMs: 0,
      frozenMessageCount: -1,
      enabled: 0, // not === false, so stays enabled
    });
    assert.equal(r.mode, HEADROOM_DEFAULTS.mode);
    assert.equal(r.minMessages, HEADROOM_DEFAULTS.minMessages);
    assert.equal(r.minPayloadChars, HEADROOM_DEFAULTS.minPayloadChars);
    assert.equal(r.timeoutMs, HEADROOM_DEFAULTS.timeoutMs);
    assert.equal(r.frozenMessageCount, undefined);
    assert.equal(r.enabled, true);
  });

  it("accepts valid overrides", () => {
    const r = resolveHeadroom({
      enabled: false,
      proxyUrl: "http://localhost:9000",
      mode: "lossy_inline",
      minMessages: 10,
      minPayloadChars: 20000,
      frozenMessageCount: 2,
      timeoutMs: 800,
      autoStart: false,
    });
    assert.equal(r.enabled, false);
    assert.equal(r.proxyUrl, "http://localhost:9000");
    assert.equal(r.mode, "lossy_inline");
    assert.equal(r.minMessages, 10);
    assert.equal(r.minPayloadChars, 20000);
    assert.equal(r.frozenMessageCount, 2);
    assert.equal(r.timeoutMs, 800);
    assert.equal(r.autoStart, false);
  });
});
