import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertUnchangedBeforeCommand,
  executeMutationThenRun,
  resolveToolPath,
  THEN_RUN_FAILED,
  THEN_RUN_SKIPPED,
  THEN_RUN_SUCCEEDED,
  withFusedFileQueue,
  type ThenRunInput,
} from "../src/action-fusion.js";
import { loadActionFusionEnabled } from "../src/config.js";

describe("loadActionFusionEnabled", () => {
  it("reads a project-level actionFusion key", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "afc-"));
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, ".pi", "acp.json"), JSON.stringify({ actionFusion: false }));
    assert.equal(await loadActionFusionEnabled(cwd), false);
  });

  it("defaults to true when no config sets the key", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "afc-"));
    // True unless the user's own global ~/.pi/acp.json sets actionFusion.
    const raw = await readFile(join(homedir(), ".pi", "acp.json"), "utf8").catch(() => "{}");
    const global = JSON.parse(raw) as { actionFusion?: unknown };
    if (typeof global.actionFusion !== "boolean") {
      assert.equal(await loadActionFusionEnabled(cwd), true);
    }
  });
});

function ok(text: string) {
  return { details: undefined, content: [{ type: "text", text }] } as const;
}

const fakeCtx = { cwd: process.cwd() } as never;

describe("resolveToolPath", () => {
  it("resolves relative paths against cwd", () => {
    const base = mkdtempSync(join(tmpdir(), "af-"));
    assert.equal(resolveToolPath(base, "a/b.ts"), join(base, "a/b.ts"));
  });

  it("strips the @ tool-path prefix", () => {
    const base = mkdtempSync(join(tmpdir(), "af-"));
    // Relative remainder: a leading "/" after the strip is a drive-root
    // absolute path on Windows by design, not a base join.
    assert.equal(resolveToolPath(base, "@sub/a.ts"), join(base, "sub/a.ts"));
  });

  it("expands ~ and ~/ against the home directory", () => {
    assert.equal(resolveToolPath(tmpdir(), "~"), homedir());
    assert.equal(resolveToolPath(tmpdir(), "~/x"), join(homedir(), "x"));
  });
});

describe("withFusedFileQueue", () => {
  it("serializes work for the same path", async () => {
    const order: string[] = [];
    const job = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      return name;
    };
    const file = join(tmpdir(), `afq-${Date.now()}-${Math.random()}.txt`);
    const [a, b] = await Promise.all([
      withFusedFileQueue(file, job("a", 20)),
      withFusedFileQueue(file, job("b", 1)),
    ]);
    assert.equal(a, "a");
    assert.equal(b, "b");
    assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
  });

  it("runs work for different paths concurrently", async () => {
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${name}:end`);
    };
    await Promise.all([
      withFusedFileQueue(join(tmpdir(), "afq-x"), job("x")),
      withFusedFileQueue(join(tmpdir(), "afq-y"), job("y")),
    ]);
    // Both jobs started before either ended. Exact ordering is not stable:
    // each queue slot awaits a canonical realpath first, which may complete
    // in either order.
    assert.ok(order.indexOf("y:start") < order.indexOf("x:end"));
    assert.ok(order.indexOf("x:start") < order.indexOf("y:end"));
  });
});

describe("executeMutationThenRun", () => {
  it("returns the mutation result unchanged when then_run is absent", async () => {
    let bashCalled = false;
    const result = await executeMutationThenRun({
      toolCallId: "t1",
      absolutePath: "/tmp/unused",
      thenRun: undefined,
      mutate: async () => ok("edited"),
      runBash: async () => {
        bashCalled = true;
        return ok("never");
      },
    });
    assert.equal(bashCalled, false);
    assert.deepEqual(result.content, [{ type: "text", text: "edited" }]);
  });

  it("skips the command when the mutation fails", async () => {
    await assert.rejects(
      executeMutationThenRun({
        toolCallId: "t2",
        absolutePath: "/tmp/unused",
        thenRun: { command: "true" },
        mutate: async () => {
          throw new Error("no such file");
        },
        runBash: async () => ok("never"),
      }),
      (e: Error) => e.message.includes("no such file") && e.message.includes(THEN_RUN_SKIPPED),
    );
  });

  it("appends the command output to the mutation result on success", async () => {
    const target = await tempTarget();
    const result = await executeMutationThenRun({
      toolCallId: "t3",
      absolutePath: target,
      thenRun: { command: "echo ok" },
      mutate: async () => ok("edited"),
      runBash: async (input: ThenRunInput) => {
        assert.equal(input.command, "echo ok");
        return ok("cmd output");
      },
    });
    const texts = result.content.map((b) => (b as { text: string }).text);
    assert.deepEqual(texts, ["edited", `${THEN_RUN_SUCCEEDED}\ncmd output`]);
  });

  it("reports the command failure but keeps the mutation", async () => {
    const target = await tempTarget();
    await assert.rejects(
      executeMutationThenRun({
        toolCallId: "t4",
        absolutePath: target,
        thenRun: { command: "exit 1" },
        mutate: async () => ok("edited"),
        runBash: async () => {
          throw new Error("exit code 1");
        },
      }),
      (e: Error) =>
        e.message.includes("edited") && e.message.includes(THEN_RUN_FAILED) && e.message.includes("exit code 1"),
    );
  });
});

/** The integrity guard re-hashes the target before running the command, so
 *  fused-path tests must point at a file that actually exists. */
async function tempTarget(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "af-"));
  const file = join(dir, "target.txt");
  await writeFile(file, "content");
  return file;
}

describe("assertUnchangedBeforeCommand", () => {
  it("passes when the file is untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "af-"));
    const file = join(dir, "f.txt");
    await writeFile(file, "stable");
    await assertUnchangedBeforeCommand(file);
  });

  it("skips the command when concurrent interference changed the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "af-"));
    const file = join(dir, "f.txt");
    await writeFile(file, "before");
    await assert.rejects(
      assertUnchangedBeforeCommand(file, async () => {
        await writeFile(file, "mutated behind our back");
      }),
      (e: Error) => e.message.includes(THEN_RUN_SKIPPED) && e.message.includes("target content changed"),
    );
  });
});
