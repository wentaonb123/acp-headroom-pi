import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEADROOM_DEFAULTS, type ResolvedHeadroom } from "../src/config.js";
import { HeadroomStage } from "../src/stage.js";
import { HeadroomStatus, formatTokens, statusText } from "../src/status.js";

function cfg(overrides: Partial<ResolvedHeadroom> = {}): ResolvedHeadroom {
  return { ...HEADROOM_DEFAULTS, ...overrides };
}

describe("formatTokens", () => {
  it("scales to k and M", () => {
    assert.equal(formatTokens(0), "0");
    assert.equal(formatTokens(999), "999");
    assert.equal(formatTokens(1234), "1.2k");
    assert.equal(formatTokens(12345), "12.3k");
    assert.equal(formatTokens(1_234_567), "1.2M");
  });
});

describe("statusText", () => {
  it("is undefined when the stage is disabled", () => {
    const stage = new HeadroomStage(() => cfg({ enabled: false }));
    assert.equal(statusText(stage, cfg({ enabled: false })), undefined);
  });

  it("shows off while the proxy is down", () => {
    const stage = new HeadroomStage(() => cfg());
    stage.lastProxyUp = false;
    assert.equal(statusText(stage, cfg()), "headroom off");
  });

  it("shows ready before any compression", () => {
    const stage = new HeadroomStage(() => cfg());
    stage.lastProxyUp = true;
    assert.equal(statusText(stage, cfg()), "headroom ready");
  });

  it("shows saved tokens and applied count once stats exist", () => {
    const stage = new HeadroomStage(() => cfg());
    stage.lastProxyUp = true;
    stage.stats = { applied: 3, savedTokens: 12345, skipped: 7 };
    assert.equal(statusText(stage, cfg()), "headroom ↓12.3k tok · 3");
  });

  it("unknown proxy state (not yet probed) still shows ready", () => {
    const stage = new HeadroomStage(() => cfg());
    assert.equal(statusText(stage, cfg()), "headroom ready");
  });
});

describe("HeadroomStatus", () => {
  it("renders via setStatus when UI is available", () => {
    const seen: Array<[string, string | undefined]> = [];
    const status = new HeadroomStatus();
    const stage = new HeadroomStage(() => cfg());
    status.attach({ setStatus: (k, t) => seen.push([k, t]) } as never, true);
    status.update(stage, cfg());
    status.detach();
    assert.deepEqual(seen, [
      ["headroom", "headroom ready"],
      ["headroom", undefined],
    ]);
  });

  it("never touches UI when hasUI is false (print/json modes)", () => {
    const status = new HeadroomStatus();
    const stage = new HeadroomStage(() => cfg());
    status.attach({ setStatus: () => { throw new Error("should not be called"); } } as never, false);
    status.update(stage, cfg());
    status.detach();
  });
});
