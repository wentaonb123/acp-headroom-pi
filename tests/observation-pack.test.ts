import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  countLines,
  createObservation,
  estimateTokens,
  isObservationId,
  isPureTextResult,
  OBSERVATION_THRESHOLD_BYTES,
  observationPath,
  placeholderFor,
  projectObservations,
  readRecallChunk,
  FULL_SENDS,
} from "../src/observation-pack.js";
import { loadObservationPackEnabled } from "../src/config.js";

function toolResult(text: string, overrides: Record<string, unknown> = {}) {
  return {
    role: "toolResult",
    isError: false,
    toolName: "bash",
    toolCallId: "call_1",
    content: [{ type: "text", text }],
    ...overrides,
  };
}

describe("createObservation", () => {
  it("skips results at or below the threshold", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const small = "x".repeat(1024);
    assert.equal(createObservation(toolResult(small), root), undefined);
    assert.equal(createObservation(toolResult("x".repeat(OBSERVATION_THRESHOLD_BYTES)), root), undefined);
  });

  it("packs oversized results with a stable id and metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const text = "line\n".repeat(20_000); // 100KB
    const a = createObservation(toolResult(text), root)!;
    const b = createObservation(toolResult(text), root)!;
    assert.ok(isObservationId(a.id));
    assert.equal(a.id, b.id); // content+tool+call addressed
    assert.equal(a.bytes, Buffer.byteLength(text, "utf8"));
    assert.equal(a.lines, 20_000);
    assert.equal(a.tokens, estimateTokens(text));
    assert.equal(a.filePath, observationPath(root, a.id));
  });

  it("only packs pure-text, non-error tool results", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const text = "y".repeat(OBSERVATION_THRESHOLD_BYTES * 2);
    assert.equal(isPureTextResult(toolResult(text)), true);
    assert.equal(isPureTextResult(toolResult(text, { isError: true })), false);
    assert.equal(isPureTextResult(toolResult(text, { role: "assistant" })), false);
    assert.equal(
      isPureTextResult(toolResult("ok", { content: [{ type: "image", data: "x" }] })),
      false,
    );
    void root;
  });
});

describe("projectObservations", () => {
  it("keeps results that have not been sent FULL_SENDS times yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const big = toolResult("z".repeat(OBSERVATION_THRESHOLD_BYTES * 2));
    const messages = [big, { role: "user", content: [{ type: "text", text: "go" }] }];
    const out = await projectObservations(messages, root);
    assert.equal(out, undefined); // 0 assistant messages after -> untouched
  });

  it("replaces an oversized result with a placeholder after FULL_SENDS", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const text = "line-1\n".repeat(20_000);
    const big = toolResult(text);
    const assistant = { role: "assistant", content: [{ type: "text", text: "done" }] };
    const messages = [big, assistant, assistant]; // 2 assistants after -> 2 sends
    const out = (await projectObservations(messages, root))!;
    assert.notEqual(out, undefined);
    const placeholder = (out[0] as { content: Array<{ text: string }> }).content[0]!.text;
    assert.match(placeholder, /id: obs_[a-f0-9]{24}/);
    assert.match(placeholder, /obs_recall/);
    assert.match(placeholder, /line-1/); // head excerpt
    assert.ok(placeholder.length < 2048);
    // The second (assistant) message is untouched.
    assert.equal(out[1], messages[1]);
    // The original is archived and readable.
    const id = /id: (obs_[a-f0-9]{24})/.exec(placeholder)![1]!;
    const stored = await readFile(observationPath(root, id), "utf8");
    assert.equal(stored, text);
  });

  it("counts sends from assistant messages, not wall-clock state", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const text = "z".repeat(OBSERVATION_THRESHOLD_BYTES * 2);
    const big = toolResult(text);
    const assistant = { role: "assistant", content: [{ type: "text", text: "ok" }] };
    // FULL_SENDS - 1 assistants after -> still full.
    const before = [big, ...Array.from({ length: FULL_SENDS - 1 }, () => assistant)];
    assert.equal(await projectObservations(before, root), undefined);
    // FULL_SENDS assistants after -> packed.
    const after = [big, ...Array.from({ length: FULL_SENDS }, () => assistant)];
    assert.notEqual(await projectObservations(after, root), undefined);
  });

  it("leaves small and structured messages alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const assistant = { role: "assistant", content: [{ type: "text", text: "ok" }] };
    const messages = [
      toolResult("tiny"),
      toolResult("img", { content: [{ type: "image", data: "x" }] }),
      toolResult("huge", { isError: true, content: [{ type: "text", text: "z".repeat(OBSERVATION_THRESHOLD_BYTES * 2) }] }),
      assistant,
      assistant,
    ];
    assert.equal(await projectObservations(messages, root), undefined);
  });
});

describe("placeholderFor", () => {
  it("carries head/tail excerpts and total size", () => {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) lines.push(`row ${i} ${"data".repeat(10)}`);
    const text = lines.join("\n");
    const obs = createObservation(
      toolResult(text),
      tmpdir(),
    )!;
    const ph = placeholderFor(obs);
    assert.match(ph, /\[large tool result replaced after its first 2 provider requests\]/);
    assert.match(ph, /row 0 /);
    assert.match(ph, /row 4999 /);
    assert.match(ph, /original_bytes: /);
    assert.equal(countLines(text) > 0, true);
  });
});

describe("readRecallChunk", () => {
  it("pages byte-exact chunks with next_offset and eof", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    await mkdir(join(root, "objects"), { recursive: true });
    // Recall reads the archive directly and does not care how the object was
    // packed, so a hand-written 10KB object is fine here.
    const text = "z".repeat(10_000);
    const filePath = join(root, "objects", "obs_" + "a".repeat(24) + ".txt");
    await writeFile(filePath, text);

    const page1 = await readRecallChunk(filePath, 0, { maxBytes: 3000, maxLines: 1000 });
    assert.equal(page1.bytes, 3000);
    assert.equal(page1.nextOffset, 3000);
    assert.equal(page1.eof, false);
    const page2 = await readRecallChunk(filePath, page1.nextOffset, { maxBytes: 3000, maxLines: 1000 });
    assert.equal(page2.eof, page2.nextOffset >= 10_000);
    const last = await readRecallChunk(filePath, 9000, { maxBytes: 3000, maxLines: 1000 });
    assert.equal(last.eof, true);
    assert.equal(last.bytes, 1000);
  });

  it("respects the line limit and never splits a multibyte character", async () => {
    const root = await mkdtemp(join(tmpdir(), "op-"));
    const file = join(root, "multi.txt");
    await mkdir(root, { recursive: true });
    const content = `${"汉字测试\n".repeat(50)}end`;
    await writeFile(file, content);
    const chunk = await readRecallChunk(file, 0, { maxBytes: 60, maxLines: 5 });
    assert.equal(chunk.lines <= 5, true);
    assert.ok(content.startsWith(chunk.text)); // no mojibake mid-character
    const chunk2 = await readRecallChunk(file, 0, { maxBytes: 3000, maxLines: 3 });
    assert.ok(chunk2.lines <= 3);
  });
});

describe("loadObservationPackEnabled", () => {
  it("reads a project-level observationPack key", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "opc-"));
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, ".pi", "acp.json"), JSON.stringify({ observationPack: false }));
    assert.equal(await loadObservationPackEnabled(cwd), false);
  });
});
