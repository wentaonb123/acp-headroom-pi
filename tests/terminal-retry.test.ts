import { test } from "node:test";
import assert from "node:assert/strict";
import { isTerminalCompressErrorText } from "../src/compress-tool.js";
import { filterActionableRanges } from "../src/index.js";

// Terminal-failure classification + stale-range filtering.
//
// Production evidence (captain's own long session): the nudge recommended
// ranges whose tails had already slid into the protected zone by the time
// the model acted. Each attempt failed with a terminal gate error
// ("already compressed / nothing to do", "too small", "protected zone"),
// the old retry logic force-injected up to 3 "call again NOW" prompts per
// turn for calls that could NEVER succeed, and the same doomed ranges were
// re-recommended next turn — a cross-turn loop of pure noise.

// ─── unit: terminal classification ──────────────────────────────────────────

test("isTerminalCompressErrorText: gate rejections are terminal, argument errors are not", () => {
  assert.equal(isTerminalCompressErrorText("Errors: Requested range(s) already compressed (e.g. b64..b101); remaining compressible content 0 chars < min 5000. Nothing to do."), true);
  assert.equal(isTerminalCompressErrorText("Total compressible content too small (2272 chars) — minimum batch is 5000. Nothing to do."), true);
  assert.equal(isTerminalCompressErrorText("range m04040..m04052: Range is entirely within the protected zone (the last 5 messages and/or the most recent user message). Adjust startId/endId to older messages."), true);
  assert.equal(isTerminalCompressErrorText("Validation failed for tool \"compress\":\n  - content.0: must be object\n\nReceived arguments:\n{\"content\":\"[]\"}"), false, "typebox validation errors are transient (fixable args)");
  assert.equal(isTerminalCompressErrorText("compress failed: unexpected end of JSON input"), false);
  assert.equal(isTerminalCompressErrorText(""), false);
});

// ─── unit: filterActionableRanges ───────────────────────────────────────────

const state = {
  messageRefs: {
    byRaw: { e1: "m00001", e2: "m00002", e3: "m00003", e4: "m00004", e5: "m00005", e6: "m00006", e7: "m00007", e8: "m00008" },
    byRef: { m00001: "e1", m00002: "e2", m00003: "e3", m00004: "e4", m00005: "e5", m00006: "e6", m00007: "e7", m00008: "e8" },
  },
};

const entries = [
  { id: "e1", message: { role: "user" } },
  { id: "e2", message: { role: "assistant" } },
  { id: "e3", message: { role: "toolResult" } },
  { id: "e4", message: { role: "assistant" } },
  { id: "e5", message: { role: "toolResult" } },
  { id: "e6", message: { role: "assistant" } },
  { id: "e7", message: { role: "user" } }, // most recent user message
  { id: "e8", message: { role: "assistant" } },
];

test("filterActionableRanges: drops ranges whose tail slid into the protected zone", () => {
  const ranges = [
    { startRef: "m00001", endRef: "m00003", tokens: 5000 }, // safe: ends before the protected tail
    { startRef: "m00002", endRef: "m00005", tokens: 8000 }, // end in protected tail (last 5)
    { startRef: "m00003", endRef: "m00007", tokens: 9000 }, // ends ON the latest user msg
  ];
  const out = filterActionableRanges(ranges, entries, state, 5);
  assert.deepEqual(out.map((r) => r.endRef), ["m00003"]);
});

test("filterActionableRanges: drops ranges with refs missing from messageRefs (stale/pruned)", () => {
  // Short entry list so the protected tail is just {m00001, m00002}; the
  // healthy range then ends OUTSIDE the tail at m00003.
  const shortEntries = [entries[0]!, entries[1]!];
  const ranges = [
    { startRef: "m00001", endRef: "m09999", tokens: 5000 }, // end pruned since snapshot
    { startRef: "m08888", endRef: "m00002", tokens: 5000 }, // start gone → atomic batch rejection
    { startRef: "m00001", endRef: "m00003", tokens: 5000 }, // healthy
  ];
  const out = filterActionableRanges(ranges, shortEntries, state, 5);
  assert.deepEqual(out.map((r) => r.endRef), ["m00003"]);
});

test("filterActionableRanges: tolerates absent state/refs (empty passthrough filter)", () => {
  const ranges = [{ startRef: "m00001", endRef: "m00002", tokens: 5000 }];
  assert.equal(filterActionableRanges(ranges, entries, undefined, 5).length, 0, "no ref map → nothing is actionable");
});

test("filterActionableRanges: keeps everything when nothing is stale or protected", () => {
  const short = [{ id: "e1", message: { role: "user" } }];
  const ranges = [{ startRef: "m00001", endRef: "m00006", tokens: 5000 }];
  // Only entry e1 is protected; range ENDS at m00006 (not protected).
  const out = filterActionableRanges(ranges, short, state, 5);
  assert.equal(out.length, 1);
});
