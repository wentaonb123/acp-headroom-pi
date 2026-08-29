import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseVersionLine, parseUpgradeOutput } from "../src/headroom/version.js";

test("parseVersionLine extracts first semver token", () => {
	assert.equal(parseVersionLine("headroom 0.37.0"), "0.37.0");
	assert.equal(parseVersionLine("headroom-ai v0.35.0\n"), "0.35.0");
	assert.equal(parseVersionLine("backend-rust 0.2.4 (c5a1f2)"), "0.2.4");
	assert.equal(parseVersionLine(""), null);
	assert.equal(parseVersionLine("unrecognized output"), null);
});

test("parseUpgradeOutput: upgraded with from/to", () => {
	const out = "Uninstalled headroom-ai v0.35.0\nInstalled 1 package: headroom-ai v0.37.0";
	const r = parseUpgradeOutput(0, out);
	assert.equal(r.status, "upgraded");
	assert.equal(r.from, "0.35.0");
	assert.equal(r.to, "0.37.0");
});

test("parseUpgradeOutput: newer uv phrasing (Installed headroom-ai v...)", () => {
	const r = parseUpgradeOutput(0, "Installed headroom-ai v0.38.0");
	assert.equal(r.status, "upgraded");
	assert.equal(r.to, "0.38.0");
	assert.equal(r.from, null);
});

test("parseUpgradeOutput: already up to date", () => {
	assert.equal(parseUpgradeOutput(0, "Audited 1 installed package").status, "uptodate");
	assert.equal(parseUpgradeOutput(0, "Already up to date: headroom-ai v0.37.0").status, "uptodate");
});

test("parseUpgradeOutput: exit 0 without markers treated as up-to-date", () => {
	assert.equal(parseUpgradeOutput(0, "").status, "uptodate");
});

test("parseUpgradeOutput: non-zero exit is an error", () => {
	const r = parseUpgradeOutput(1, "error: Failed to download package");
	assert.equal(r.status, "error");
});