/*
 * test_selfcheck.mjs - runnable check for the Freelancer sync logic.
 *
 *   node test_selfcheck.mjs
 *
 * No framework: plain asserts over the pure reconciliation plus one end-to-end
 * pass of applyPlan() on a throwaway temp folder.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyBid, slugify, folderName, plannedActions, scanExisting, applyPlan } from "./freelancer-sync.mjs";

function check(name, fn) {
  fn();
  console.log("ok - " + name);
}

check("classifyBid", () => {
  assert.equal(classifyBid("active"), "pending");
  assert.equal(classifyBid("awarded"), "awarded");
  assert.equal(classifyBid("accepted"), "awarded");
  assert.equal(classifyBid("rejected"), "gone");
  assert.equal(classifyBid("revoked"), "gone");
  assert.equal(classifyBid(undefined), "gone");
});

check("slugify / folderName", () => {
  assert.equal(slugify("Excel Sales & Inventory Tracker"), "excel-sales-inventory-tracker");
  assert.equal(slugify("   "), "project");
  assert.equal(folderName(40771195, "Excel Sales & Inventory Tracker"), "40771195-excel-sales-inventory-tracker");
});

check("plannedActions", () => {
  const existing = [
    { id: 4071, loc: "root", name: "4071-alpha" },       // pending bid, wrong folder -> move to pending
    { id: 4072, loc: "root", name: "4072-beta" },        // awarded bid -> move to awarded
    { id: 4099, loc: "awarded", name: "4099-old" },      // no bid -> delete
    { id: 4080, loc: "pending", name: "4080-gone" }      // rejected bid -> delete
  ];
  const bids = [
    { id: 4071, title: "Alpha", status: "active" },
    { id: 4072, title: "Beta", status: "awarded" },
    { id: 4073, title: "Gamma New", status: "active" },  // no folder -> create
    { id: 4080, title: "Gone", status: "rejected" }
  ];
  const plan = plannedActions(existing, bids);
  assert.deepEqual(plan.moves.map((m) => [m.id, m.from, m.to]).sort(), [[4071, "root", "pending"], [4072, "root", "awarded"]]);
  assert.deepEqual(plan.creates.map((c) => [c.id, c.kind, c.name]), [[4073, "pending", "4073-gamma-new"]]);
  assert.deepEqual(plan.deletes.map((d) => d.id).sort(), [4080, 4099]);
});

check("applyPlan on a temp dir", () => {
  const base = mkdtempSync(join(tmpdir(), "fln-sync-"));
  try {
    mkdirSync(join(base, "4071-alpha"));
    mkdirSync(join(base, "4072-beta"));
    mkdirSync(join(base, "awarded", "4099-old"), { recursive: true });

    const bids = [
      { id: 4071, title: "Alpha", status: "active" },
      { id: 4072, title: "Beta", status: "awarded" },
      { id: 4073, title: "Gamma New", status: "active" }
    ];
    const plan = plannedActions(scanExisting(base), bids);
    applyPlan(base, plan);

    assert.ok(existsSync(join(base, "pending", "4071-alpha")), "4071 moved into pending/");
    assert.ok(existsSync(join(base, "awarded", "4072-beta")), "4072 moved into awarded/");
    assert.ok(existsSync(join(base, "pending", "4073-gamma-new")), "4073 created in pending/");
    assert.ok(!existsSync(join(base, "4071-alpha")), "old root folder gone");
    assert.ok(!existsSync(join(base, "awarded", "4099-old")), "folder without a bid deleted");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

console.log("\nall self-checks passed");
