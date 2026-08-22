import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ACP_TOOLS } from "../src/setup-subagent-tools.js";

const { ensureSubagentAcpTools } = await import("../src/setup-subagent-tools.js");

let tmp: string;
let agentDir: string;
let projectDir: string;
let settingsPath: string;

function writeSettings(data: Record<string, unknown>): void {
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
}

function overridesOf(settings: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const sub = settings.subagents as Record<string, unknown>;
  return (sub.agentOverrides ?? {}) as Record<string, Record<string, unknown>>;
}

/** Create a fake pi-subagents install with the agent set from v0.53.0. */
function installPiSubagents(dir: string): void {
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "pi-subagents", version: "0.53.0" }, null, 2) + "\n",
  );
  const agents: Array<[string, string[] | null]> = [
    ["worker", ["read", "grep", "find", "ls", "bash", "edit", "write", "contact_supervisor"]],
    ["reviewer", ["read", "grep", "find", "ls"]],
    ["oracle", null], // unrestricted — no tools line in frontmatter
  ];
  for (const [name, tools] of agents) {
    const lines = ["---", `name: ${name}`];
    if (tools) lines.push(`tools: ${tools.join(", ")}`);
    lines.push("---", `# ${name}`);
    fs.writeFileSync(path.join(dir, "agents", `${name}.md`), lines.join("\n") + "\n");
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-setup-test-"));
  agentDir = path.join(tmp, "agent");
  projectDir = path.join(tmp, "proj");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  settingsPath = path.join(agentDir, "settings.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ensureSubagentAcpTools — pi-subagents detection (#179)", () => {
  it("skips without touching settings when pi-subagents is not installed", () => {
    const stale = {
      subagents: {
        agentOverrides: {
          advisor: { model: "test-model", tools: ["read", "grep", "find", "ls", "compress"] },
        },
      },
    };
    writeSettings(stale);

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "skipped");
    assert.match(result.reason ?? "", /not installed/);

    const after = readSettings();
    assert.deepEqual(
      overridesOf(after).advisor.tools,
      ["read", "grep", "find", "ls", "compress"],
    );
    assert.ok(!fs.existsSync(`${settingsPath}.acp-bak`), "no backup when skipped");
  });

  it("does not create settings-related artifacts when pi-subagents is absent", () => {
    writeSettings({});
    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "skipped");
    assert.deepEqual(readSettings(), {});
  });

  it("detects a user-scope npm install under <agentDir>/npm/node_modules", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    writeSettings({});

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "updated");

    const overrides = overridesOf(readSettings());
    assert.deepEqual(overrides.worker.tools, [
      "read", "grep", "find", "ls", "bash", "edit", "write", "contact_supervisor",
      ...ACP_TOOLS,
    ]);
    assert.deepEqual(overrides.reviewer.tools, ["read", "grep", "find", "ls", ...ACP_TOOLS]);
    assert.ok(!("oracle" in overrides), "unrestricted agent must not get an override entry");
  });

  it("detects a project-scope npm install under <cwd>/.pi/npm/node_modules", () => {
    installPiSubagents(path.join(projectDir, ".pi", "npm", "node_modules", "pi-subagents"));
    writeSettings({});

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "updated");
    const overrides = overridesOf(readSettings());
    assert.ok(ACP_TOOLS.every((t) => (overrides.worker.tools as string[]).includes(t)));
  });

  it("detects pi-subagents placed in the extensions directory", () => {
    const extDir = path.join(agentDir, "extensions", "pi-subagents");
    installPiSubagents(extDir);
    writeSettings({});

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "updated");
    const overrides = overridesOf(readSettings());
    assert.ok(ACP_TOOLS.every((t) => (overrides.reviewer.tools as string[]).includes(t)));
  });

  it("accepts an explicit installDir outside the detected locations", () => {
    const hidden = path.join(projectDir, "vendor", "pi-subagents-fork");
    installPiSubagents(hidden);
    writeSettings({});

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir, installDir: hidden });
    assert.equal(result.action, "updated");
    const overrides = overridesOf(readSettings());
    assert.ok(ACP_TOOLS.every((t) => (overrides.worker.tools as string[]).includes(t)));
  });

  it("fails with a clear reason when the explicit installDir is not a package", () => {
    writeSettings({});
    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir, installDir: path.join(projectDir, "nope") });
    assert.equal(result.action, "failed");
    assert.match(result.reason ?? "", /not a package/);
    assert.deepEqual(readSettings(), {});
  });

  it("skips when the install ships no agents/*.md", () => {
    const installDir = path.join(agentDir, "npm", "node_modules", "pi-subagents");
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "pi-subagents" }));
    writeSettings({});

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "skipped");
    assert.match(result.reason ?? "", /no agents/);
    assert.deepEqual(readSettings(), {});
  });

  it("never recreates the stale 9-agent set — only agents the package ships", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    writeSettings({
      subagents: {
        agentOverrides: {
          // Leftovers from older billion-context-pi versions.
          advisor: { tools: ["read", "bash", "intercom", "compress"] },
          planner: { tools: ["read", "grep", "find", "ls", "bash", "intercom"] },
        },
      },
    });

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "updated");

    const overrides = overridesOf(readSettings());
    // Stale entries are preserved byte-for-byte (we never rewrite them).
    assert.deepEqual(overrides.advisor.tools, ["read", "bash", "intercom", "compress"]);
    assert.deepEqual(overrides.planner.tools, ["read", "grep", "find", "ls", "bash", "intercom"]);
    assert.deepEqual(Object.keys(overrides).sort(), ["advisor", "planner", "reviewer", "worker"]);
  });
});

describe("ensureSubagentAcpTools — merge behavior", () => {
  it("appends missing ACP tools to a user-custom override", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    writeSettings({
      subagents: {
        agentOverrides: {
          worker: { tools: ["bash", "read"], model: "my-model" },
        },
      },
    });

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "updated");

    const worker = overridesOf(readSettings()).worker;
    assert.deepEqual(worker.tools, ["bash", "read", ...ACP_TOOLS]);
    assert.equal(worker.model, "my-model", "non-tools fields are preserved");
  });

  it("completes an override that already has some ACP tools without reordering", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    writeSettings({
      subagents: {
        agentOverrides: {
          worker: { tools: ["read", "compress"] },
        },
      },
    });

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "updated");

    const tools = overridesOf(readSettings()).worker.tools as string[];
    assert.deepEqual(tools, ["read", "compress", "decompress", "search_context", "acp_status"]);
  });

  it("is idempotent — second run is a no-op", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    writeSettings({});

    assert.equal(ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir }).action, "updated");
    const snapshot = fs.readFileSync(settingsPath, "utf-8");
    const second = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(second.action, "skipped");
    assert.match(second.reason ?? "", /already have ACP tools/);
    assert.equal(fs.readFileSync(settingsPath, "utf-8"), snapshot);
  });

  it("creates a backup once and keeps it on later updates", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    writeSettings({});

    assert.equal(ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir }).action, "updated");
    assert.ok(fs.existsSync(`${settingsPath}.acp-bak`));
    const backupSnapshot = fs.readFileSync(`${settingsPath}.acp-bak`, "utf-8");
    // Simulate a further user edit then another update.
    fs.writeFileSync(settingsPath, JSON.stringify({ subagents: {} }, null, 2) + "\n");
    assert.equal(ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir }).action, "updated");
    assert.equal(fs.readFileSync(`${settingsPath}.acp-bak`, "utf-8"), backupSnapshot);
  });
});

describe("ensureSubagentAcpTools — error handling", () => {
  it("skips when settings.json is missing", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "skipped");
    assert.match(result.reason ?? "", /not found/);
  });

  it("fails on invalid JSON without modifying the file", () => {
    installPiSubagents(path.join(agentDir, "npm", "node_modules", "pi-subagents"));
    const broken = "{ not valid json";
    fs.writeFileSync(settingsPath, broken, "utf-8");

    const result = ensureSubagentAcpTools(settingsPath, { agentDir, cwd: projectDir });
    assert.equal(result.action, "failed");
    assert.match(result.reason ?? "", /not valid JSON/);
    assert.equal(fs.readFileSync(settingsPath, "utf-8"), broken);
  });
});
