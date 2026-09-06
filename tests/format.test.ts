import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { payloadChars, projectPayload } from "../src/format.js";

const stringPayload = {
  model: "gpt-test",
  messages: [
    { role: "system", content: "You are a test." },
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi", name: "keepme" },
  ],
  temperature: 0.5,
};

describe("projectPayload", () => {
  it("projects plain-string payloads and round-trips", () => {
    const view = projectPayload(stringPayload);
    assert.ok(view);
    assert.equal(view.messages.length, 3);
    assert.equal(view.messages[2].name, undefined); // projection is role+content only
    const compressed = view.messages.map((m, i) => ({ ...m, content: `c${i}` }));
    const out = view.apply(compressed) as typeof stringPayload;
    assert.equal(out.temperature, 0.5); // payload-level fields survive
    assert.equal(out.model, "gpt-test");
    assert.equal(out.messages[0].content, "c0");
    assert.equal(out.messages[2].name, "keepme"); // message-level fields survive
    assert.equal(out.messages[2].role, "assistant");
  });

  it("all-text block arrays are compressible", () => {
    const p = {
      messages: [
        { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      ],
    };
    const view = projectPayload(p);
    assert.ok(view);
    assert.equal(view.messages[0].content, "a\nb");
    const out = view.apply([{ role: "user", content: "ab" }]) as typeof p;
    assert.equal(out.messages[0].content, "ab");
  });

  it("rejects structured content (tool calls / images) wholesale", () => {
    assert.equal(projectPayload({
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "1", input: {} }] }],
    }), null);
    assert.equal(projectPayload({
      messages: [{ role: "user", content: [{ type: "image", source: {} }] }],
    }), null);
  });

  it("rejects non-object payloads and missing messages", () => {
    assert.equal(projectPayload("nope"), null);
    assert.equal(projectPayload(null), null);
    assert.equal(projectPayload({ model: "m" }), null);
    assert.equal(projectPayload({ messages: [{ content: "no role" }] }), null);
  });

  it("count mismatch from the proxy falls back to the compressed array", () => {
    const view = projectPayload(stringPayload);
    assert.ok(view);
    const merged = [
      { role: "system", content: "merged" },
      { role: "user", content: "rest" },
    ];
    const out = view.apply(merged) as { messages: Array<{ role: string; name?: string }> };
    assert.equal(out.messages.length, 2);
    assert.equal(out.messages[0].content, "merged");
    assert.equal(out.messages[1].name, undefined); // cannot trust index mapping
  });

  it("does not mutate the original payload", () => {
    const snapshot = JSON.stringify(stringPayload);
    const view = projectPayload(stringPayload);
    assert.ok(view);
    view.apply(view.messages.map((m) => ({ ...m, content: "x" })));
    assert.equal(JSON.stringify(stringPayload), snapshot);
  });
});

describe("payloadChars", () => {
  it("sums content lengths", () => {
    assert.equal(payloadChars([{ role: "u", content: "abcd" }, { role: "a", content: "ef" }]), 6);
    assert.equal(payloadChars([]), 0);
  });
});
