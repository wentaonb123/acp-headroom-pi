import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeRetrieveTool } from "../src/retrieve-tool.js";
import { HEADROOM_DEFAULTS } from "../src/config.js";

function tool() {
  return makeRetrieveTool(() => HEADROOM_DEFAULTS) as unknown as {
    name: string;
    execute: (
      id: string,
      params: unknown,
    ) => Promise<{ content: Array<{ type: string; text: string }> }>;
  };
}

describe("headroom_retrieve tool", () => {
  it("rejects malformed hashes without touching the network", async () => {
    const t = tool();
    assert.equal(t.name, "headroom_retrieve");
    const res = await t.execute("id", { hash: "../../etc/passwd" });
    assert.match(res.content[0].text, /No stored original found/);
  });

  it("reports a miss for a well-formed but unknown hash", async () => {
    const t = tool();
    const res = await t.execute("id", { hash: "a".repeat(24) });
    assert.match(res.content[0].text, /No stored original found for hash a{24}/);
  });
});
