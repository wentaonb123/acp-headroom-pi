/**
 * Action Fusion — fuse a file mutation and its follow-up command into one turn.
 *
 * Adapted from NVLabs/SoL-Pi (MIT, https://github.com/NVlabs/SoL-Pi),
 * src/sol-pi/extensions/action-fusion/. Base rollouts repeatedly show the
 * same pair of turns: edit or write a file, then run a command to build, test,
 * or start it. The fused tools take an optional `then_run` parameter, apply
 * the mutation, run the command, and return one combined observation — the
 * model decision between the two turns disappears (one model round-trip saved
 * per edit+validate pair).
 *
 * Everything else about `edit` and `write` is inherited from pi's built-in
 * definitions: schemas, prompt text, argument shims, and renderers. On by
 * default; the acp.json `actionFusion` key (set false) restores pi's stock
 * tools.
 */

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  type AgentToolResult,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { log } from "./log.js";

export const THEN_RUN_SUCCEEDED = "[then_run:succeeded]";
export const THEN_RUN_FAILED = "[then_run:failed]";
export const THEN_RUN_SKIPPED = "[then_run:skipped]";

export interface ThenRunInput {
  command: string;
  timeout?: number;
}

export function createThenRunSchema(description: string) {
  return Type.Optional(
    Type.Object(
      {
        command: Type.String({ description: "Bash command to run" }),
        timeout: Type.Optional(
          Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
        ),
      },
      { description },
    ),
  );
}

const EDIT_THEN_RUN_DESCRIPTION =
  "Command to run next on this file after the edit succeeds — e.g. run, build, start/restart, install, or check it; optional timeout in seconds. Skipped if the edit fails; a non-zero exit is reported but keeps the edit.";
const WRITE_THEN_RUN_DESCRIPTION =
  "Command to run next on this file after the write succeeds — e.g. run, build, start/restart, install, or check it; optional timeout in seconds. Skipped if the write fails; a non-zero exit is reported but keeps the write.";

// --- path resolution --------------------------------------------------------

function stripToolPathPrefix(filePath: string): string {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

/** Normalize whatever the model passed as a tool path (relative, `@`-prefixed,
 *  `file://` URL, `~/...`) to the absolute target the queue and hash guard
 *  must both agree on. */
export function resolveToolPath(cwd: string, filePath: string): string {
  const stripped = stripToolPathPrefix(filePath);
  const expanded = stripped.startsWith("file://") ? fileURLToPath(stripped) : stripped;
  if (expanded === "~") return homedir();
  if (expanded.startsWith("~/")) return resolve(homedir(), expanded.slice(2));
  return resolve(cwd, expanded);
}

// --- per-file operation queue ----------------------------------------------

const queueTails = new Map<string, Promise<void>>();

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** realpath of the longest existing ancestor, so a not-yet-created file still
 *  queues on the directory its symlinked parent resolves to. */
async function canonicalQueueKey(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath);
  let current = resolvedPath;
  const missingSegments: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(current), ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return resolvedPath;
      missingSegments.unshift(basename(current));
      current = parent;
    }
  }
}

/** Serialize fused operations for one canonical file path, so two fused
 *  mutations of the same file cannot interleave mutation + command. This
 *  queue is ours and intentionally does not nest pi's built-in mutation
 *  queue. */
export async function withFusedFileQueue<T>(filePath: string, work: () => Promise<T>): Promise<T> {
  const key = await canonicalQueueKey(filePath);
  const previous = queueTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const owned = new Promise<void>((resolveOwned) => {
    release = resolveOwned;
  });
  const tail = previous.then(() => owned);
  queueTails.set(key, tail);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (queueTails.get(key) === tail) queueTails.delete(key);
  }
}

// --- mutation + command execution -------------------------------------------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function thenRunSkippedError(error: unknown): Error {
  return new Error(
    `${errorText(error)}\n\n${THEN_RUN_SKIPPED} The file mutation did not complete successfully; the command was not run.`,
  );
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** Detect interference between the fused mutation and the command: hash the
 *  target, yield once (letting any queued writer land), then hash again.
 *  A mismatch means something else touched the file — running the command
 *  now would validate the wrong content. */
export async function assertUnchangedBeforeCommand(
  path: string,
  yieldForInterference: () => Promise<void> = () =>
    new Promise<void>((resolve) => setImmediate(resolve)),
): Promise<void> {
  try {
    const mutationHash = await fileSha256(path);
    await yieldForInterference();
    const commandHash = await fileSha256(path);
    if (mutationHash !== commandHash) {
      throw new Error("target content changed after the fused mutation");
    }
  } catch (error) {
    throw new Error(`${THEN_RUN_SKIPPED} ${errorText(error)}; the command was not run.`);
  }
}

export interface ExecuteMutationThenRunOptions<TDetails> {
  toolCallId: string;
  absolutePath: string;
  thenRun: ThenRunInput | undefined;
  mutate: () => Promise<AgentToolResult<TDetails>>;
  /** Bash executor for the follow-up command. Defaults to pi's built-in bash
   *  tool; injectable so tests never spawn a shell. */
  runBash?: (thenRun: ThenRunInput) => Promise<AgentToolResult<unknown>>;
  signal?: AbortSignal;
  ctx: ExtensionContext;
}

/** Apply a file mutation and, when the model asked for one, run its follow-up
 *  command before returning a single observation. Mutation failure skips the
 *  command (`[then_run:skipped]`); command failure is reported but keeps the
 *  mutation (`[then_run:failed]`). */
export async function executeMutationThenRun<TDetails>({
  toolCallId,
  absolutePath,
  thenRun,
  mutate,
  runBash,
  signal,
  ctx,
}: ExecuteMutationThenRunOptions<TDetails>): Promise<AgentToolResult<TDetails>> {
  return withFusedFileQueue(absolutePath, async (): Promise<AgentToolResult<TDetails>> => {
    let mutationResult: AgentToolResult<TDetails>;
    try {
      mutationResult = await mutate();
    } catch (error) {
      if (thenRun !== undefined) {
        throw thenRunSkippedError(error);
      }
      throw error;
    }

    if (thenRun === undefined) {
      return mutationResult;
    }

    await assertUnchangedBeforeCommand(absolutePath);
    try {
      const bash =
        runBash ??
        (async (input: ThenRunInput) => {
          const bashTool = createBashToolDefinition(ctx.cwd);
          return bashTool.execute(`${toolCallId}:then_run`, input, signal, undefined, ctx);
        });
      const bashResult = await bash(thenRun);
      const output = resultText(bashResult);
      log.info({ event: "action-fusion", phase: "then-run", tool: toolCallId, ok: true });
      return {
        ...mutationResult,
        content: [
          ...mutationResult.content,
          { type: "text", text: output ? `${THEN_RUN_SUCCEEDED}\n${output}` : THEN_RUN_SUCCEEDED },
        ],
      };
    } catch (error) {
      log.info({ event: "action-fusion", phase: "then-run", tool: toolCallId, ok: false });
      const mutationOutput = resultText(mutationResult);
      throw new Error([mutationOutput, THEN_RUN_FAILED, errorText(error)].filter(Boolean).join("\n\n"));
    }
  });
}

// --- tool registration -------------------------------------------------------

/** Built-in tool definitions capture their cwd in closures, so keep one per
 *  working directory instead of rebuilding them on every call. */
function memoizeByCwd<T>(create: (cwd: string) => T): (cwd: string) => T {
  const cache = new Map<string, T>();
  return (cwd) => {
    const cached = cache.get(cwd);
    if (cached) return cached;
    const created = create(cwd);
    cache.set(cwd, created);
    return created;
  };
}

/** Replace pi's built-in `edit` and `write` with fused versions. Call once
 *  per session, only when the acp.json `actionFusion` key enables it. */
export function registerActionFusionTools(pi: ExtensionAPI): void {
  const baseEdit = memoizeByCwd((cwd: string) => createEditToolDefinition(cwd));
  const baseWrite = memoizeByCwd((cwd: string) => createWriteToolDefinition(cwd));
  const editTemplate = baseEdit(process.cwd());
  const writeTemplate = baseWrite(process.cwd());

  const editParameters = Type.Object({
    ...editTemplate.parameters.properties,
    then_run: createThenRunSchema(EDIT_THEN_RUN_DESCRIPTION),
  });
  pi.registerTool<typeof editParameters, EditToolDetails | undefined>({
    ...editTemplate,
    parameters: editParameters,
    async execute(toolCallId, input, signal, onUpdate, ctx) {
      const { then_run, ...editInput } = input as Static<typeof editParameters>;
      return executeMutationThenRun<EditToolDetails | undefined>({
        toolCallId,
        absolutePath: resolveToolPath(ctx.cwd, String(editInput.path ?? "")),
        thenRun: then_run,
        mutate: () => baseEdit(ctx.cwd).execute(toolCallId, editInput as never, signal, onUpdate, ctx),
        signal,
        ctx,
      });
    },
  });

  const writeParameters = Type.Object({
    ...writeTemplate.parameters.properties,
    then_run: createThenRunSchema(WRITE_THEN_RUN_DESCRIPTION),
  });
  pi.registerTool<typeof writeParameters, undefined>({
    ...writeTemplate,
    parameters: writeParameters,
    async execute(toolCallId, input, signal, onUpdate, ctx) {
      const { then_run, ...writeInput } = input as Static<typeof writeParameters>;
      return executeMutationThenRun<undefined>({
        toolCallId,
        absolutePath: resolveToolPath(ctx.cwd, String(writeInput.path ?? "")),
        thenRun: then_run,
        mutate: () => baseWrite(ctx.cwd).execute(toolCallId, writeInput as never, signal, onUpdate, ctx),
        signal,
        ctx,
      });
    },
  });
}
