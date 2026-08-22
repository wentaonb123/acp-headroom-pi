import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../src/runtime.js";

// Regression for the acquireLock release bug: release() used to delete the
// map entry unconditionally — under 3-way contention the releaser removed a
// WAITER's registration, letting a third caller barge in while the waiter
// still held the lock (mutual exclusion broken exactly when contended).

test("acquireLock: a third caller must not barge in while the second holds the lock", async () => {
	const rt = createRuntime({});
	const events: string[] = [];

	const relA = await rt.acquireLock("s");

	// B queues behind A.
	let relB!: () => void;
	const enteredB = rt.acquireLock("s").then((rel) => {
		events.push("enter-B");
		relB = rel;
	});

	// A releases → B enters. The buggy version deleted B's registration here,
	// leaving the map empty.
	relA();
	await enteredB;
	assert.ok(events.includes("enter-B"), "B runs after A releases");

	// C arrives while B holds the lock.
	let relC!: () => void;
	const enteredC = rt.acquireLock("s").then((rel) => {
		events.push("enter-C");
		relC = rel;
	});

	await new Promise((r) => setTimeout(r, 20));
	assert.equal(events.includes("enter-C"), false, "C must wait while B holds the lock");

	relB();
	await enteredC;
	assert.ok(events.includes("enter-C"), "C runs after B releases");
	relC();
});

test("acquireLock: uncontended and sequential use still works", async () => {
	const rt = createRuntime({});
	const rel1 = await rt.acquireLock("s");
	const order: string[] = [];
	const p2 = rt.acquireLock("s").then((rel2) => {
		order.push("second");
		rel2();
	});
	order.push("first-still-held");
	rel1();
	await p2;
	assert.deepEqual(order, ["first-still-held", "second"]);
});
