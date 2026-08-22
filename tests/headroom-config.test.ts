import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHeadroom, DEFAULT_PROTECTED_TOOLS } from "../src/headroom/config.js";

test("resolveHeadroom applies defaults when nothing is set", () => {
  const cfg = resolveHeadroom({});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.proxyUrl, "http://127.0.0.1:8787");
  assert.equal(cfg.minChars, 4000);
  assert.equal(cfg.maxPerTurn, 8);
  assert.equal(cfg.timeoutMs, 3000);
  assert.equal(cfg.autoStart, true);
  assert.ok(cfg.protectedTools.includes("compress"));
  assert.ok(cfg.protectedTools.includes("headroom_retrieve"));
});

test("resolveHeadroom headroom:false disables the stage", () => {
  const cfg = resolveHeadroom({ headroom: false });
  assert.equal(cfg.enabled, false);
});

test("resolveHeadroom boolean true keeps defaults", () => {
  const cfg = resolveHeadroom({ headroom: true });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.minChars, 4000);
});

test("HEADROOM_PROXY_URL env wins over settings and default", () => {
  const prev = process.env.HEADROOM_PROXY_URL;
  process.env.HEADROOM_PROXY_URL = "http://127.0.0.1:9999/";
  try {
    const cfg = resolveHeadroom({ headroom: { proxyUrl: "http://127.0.0.1:7777" } });
    assert.equal(cfg.proxyUrl, "http://127.0.0.1:9999");
  } finally {
    if (prev === undefined) delete process.env.HEADROOM_PROXY_URL;
    else process.env.HEADROOM_PROXY_URL = prev;
  }
});

test("settings proxyUrl wins when env is unset; trailing slashes are stripped", () => {
  const prev = process.env.HEADROOM_PROXY_URL;
  delete process.env.HEADROOM_PROXY_URL;
  try {
    const cfg = resolveHeadroom({ headroom: { proxyUrl: "http://127.0.0.1:7000///" } });
    assert.equal(cfg.proxyUrl, "http://127.0.0.1:7000");
  } finally {
    if (prev !== undefined) process.env.HEADROOM_PROXY_URL = prev;
  }
});

test("protectedTools merge with the built-in list and dedupe", () => {
  const cfg = resolveHeadroom({ headroom: { protectedTools: ["my_tool", "compress"] } });
  for (const t of DEFAULT_PROTECTED_TOOLS) assert.ok(cfg.protectedTools.includes(t));
  assert.ok(cfg.protectedTools.includes("my_tool"));
  assert.equal(cfg.protectedTools.filter((t) => t === "compress").length, 1);
});

test("invalid numeric settings fall back to defaults", () => {
  const cfg = resolveHeadroom({ headroom: { minChars: -5, maxPerTurn: Number.NaN, timeoutMs: Infinity } });
  assert.equal(cfg.minChars, 4000);
  assert.equal(cfg.maxPerTurn, 8);
  assert.equal(cfg.timeoutMs, 3000);
});
