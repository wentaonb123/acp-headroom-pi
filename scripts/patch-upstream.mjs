#!/usr/bin/env node
// Idempotent postinstall patch for the billion-context-pi dependency.
//
// We keep this plugin a pure fusion of two upstream projects, so we patch as
// little as possible: only the one bug upstream has not absorbed yet. The
// negative-growth nudge deadlock (see NUDGE-COUNT-GATE-FIX.md): after a
// compression, tokenCount falls below lastNudgeShownTokens (the high-water
// stamp), so growthSinceReference goes negative and — since all soft-nudge
// gates sit under growthReady — no nudge ever fires again despite ready
// compressible content. Fix: clamp growthSinceReference at 0, treating a
// compression fallback as "new baseline", not permanent debt.
//
// The count-gate promotion this project used to patch in has been absorbed
// upstream natively (bcp >= 0.1.5x) and is intentionally NOT re-applied here.
// If the clamp anchor ever disappears, distinguish "upstream fixed it" from
// "anchor moved" before assuming breakage.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "node_modules", "billion-context-pi", "dist", "index.js");

if (!existsSync(target)) {
  console.log("[patch-upstream] billion-context-pi dist not found, skipping");
  process.exit(0);
}

let src = readFileSync(target, "utf8");
const CLAMP_FIXED = "Math.max(0, tokenCount - growthReference)";
const CLAMP_OLD = "  const growthSinceReference = tokenCount - growthReference;";
const CLAMP_NEW = `  // acp-headroom-pi postinstall: compression-induced fallback is treated as
  // "new baseline", not permanent debt — negative growth must never block nudges.
  const growthSinceReference = Math.max(0, tokenCount - growthReference);`;

if (src.includes(CLAMP_FIXED)) {
  console.log("[patch-upstream] clamp already present (patched or fixed upstream)");
  process.exit(0);
}

if (src.includes(CLAMP_OLD)) {
  writeFileSync(target, src.replace(CLAMP_OLD, CLAMP_NEW), "utf8");
  console.log("[patch-upstream] applied: clamp growthSinceReference at 0");
  process.exit(0);
}

console.error(
  "[patch-upstream] WARN: clamp anchor not found. Either upstream fixed the " +
    "negative-growth deadlock (then remove this script's clamp patch) or the " +
    "dist layout changed (then re-locate the anchor).",
);
process.exit(0); // never break installation over a patch
