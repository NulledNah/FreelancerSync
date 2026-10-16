/*
 * freelancer-sync.mjs - pure sync logic for the Freelancer rail button.
 *
 * No electron dependency: it only needs fs + the network (global fetch), so the
 * reconciliation can be unit-checked with plain node (see test_selfcheck.mjs).
 *
 * Given the Freelancer bids of the logged-in user, it keeps the local project
 * folders in sync:
 *   - bids pending -> <dir>/pending/<project-id>-<slug>
 *   - bids awarded -> <dir>/awarded/<project-id>-<slug>
 *   - folders whose project is no longer pending nor awarded are deleted
 * An existing folder is matched by its numeric id prefix, so its hand-written
 * slug name is preserved when it just moves between pending/ and awarded/.
 */
import { readdirSync, mkdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_API = "https://www.freelancer.com/api";

export function classifyBid(status) {
  const s = String(status || "").toLowerCase();
  if (s === "active") return "pending";
  if (s === "awarded" || s === "accepted") return "awarded";
  return "gone";
}

export function slugify(title) {
  const s = String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "project";
}

export function folderName(id, title) {
  return id + "-" + slugify(title);
}

/*
 * Pure reconciliation. Plain-data in, plain-data out, so it is trivial to test:
 *   existing: [{ id, loc, name }]   loc in "root" | "pending" | "awarded"
 *   bids:     [{ id, title, status }]
 * Returns { moves, creates, deletes }.
 */
export function plannedActions(existing, bids) {
  const byId = new Map();
  for (const e of existing) byId.set(e.id, e);

  const targets = new Map();
  for (const b of bids) {
    const kind = classifyBid(b.status);
    if (kind === "gone") continue; // not a target -> any folder for it gets deleted
    targets.set(b.id, { kind: kind, title: b.title });
  }

  const plan = { moves: [], creates: [], deletes: [] };
  for (const [id, t] of targets) {
    const ex = byId.get(id);
    if (ex) {
      if (ex.loc !== t.kind) plan.moves.push({ id: id, from: ex.loc, to: t.kind, name: ex.name });
    } else {
      plan.creates.push({ id: id, kind: t.kind, name: folderName(id, t.title) });
    }
  }
  for (const e of existing) {
    if (!targets.has(e.id)) plan.deletes.push({ id: e.id, loc: e.loc, name: e.name });
  }
  return plan;
}

function locDir(baseDir, loc) {
  return loc === "root" ? baseDir : join(baseDir, loc);
}

export function scanExisting(baseDir) {
  const out = [];
  const scan = (dir, loc) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const m = /^(\d+)-/.exec(entry.name);
      if (m) out.push({ id: Number(m[1]), loc: loc, name: entry.name });
    }
  };
  scan(baseDir, "root");
  scan(join(baseDir, "pending"), "pending");
  scan(join(baseDir, "awarded"), "awarded");
  return out;
}

export function applyPlan(baseDir, plan) {
  mkdirSync(join(baseDir, "pending"), { recursive: true });
  mkdirSync(join(baseDir, "awarded"), { recursive: true });
  for (const m of plan.moves) {
    const from = join(locDir(baseDir, m.from), m.name);
    const to = join(baseDir, m.to, m.name);
    try { if (existsSync(from)) renameSync(from, to); } catch (e) { /* keep going */ }
  }
  for (const c of plan.creates) {
    try { mkdirSync(join(baseDir, c.kind, c.name), { recursive: true }); } catch (e) { /* keep going */ }
  }
  for (const d of plan.deletes) {
    try { rmSync(join(locDir(baseDir, d.loc), d.name), { recursive: true, force: true }); } catch (e) { /* keep going */ }
  }
}

async function apiGet(apiBase, path, token) {
  const res = await fetch(apiBase + path, { headers: { "freelancer-oauth-v1": token } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  if (!json || json.status !== "success") throw new Error((json && (json.message || json.error_code)) || "API error");
  return json.result;
}

export async function fetchBids(apiBase, token) {
  const self = await apiGet(apiBase, "/users/0.1/self", token);
  const selfId = self && self.id;
  const bids = [];
  let offset = 0;
  for (;;) {
    const path = "/projects/0.1/bids?bidders%5B%5D=" + selfId +
      "&project_details=true&limit=50&offset=" + offset;
    const result = await apiGet(apiBase, path, token);
    const list = (result && result.bids) || [];
    const projects = (result && result.projects) || {};
    for (const b of list) {
      const p = projects[b.project_id] || {};
      bids.push({
        id: b.project_id,
        title: p.title || "",
        status: b.frontend_bid_status || (b.retracted ? "revoked" : "active"),
      });
    }
    if (list.length < 50) break;
    offset += 50;
  }
  return bids;
}

/*
 * Safety: if the API returns no bids we abort before touching the filesystem,
 * so a transient failure can never wipe the local folders.
 */
export async function runSync(baseDir, token, apiBase) {
  const base = apiBase || DEFAULT_API;
  const bids = await fetchBids(base, token);
  if (!bids.length) throw new Error("no_bids_returned");
  const existing = scanExisting(baseDir);
  const plan = plannedActions(existing, bids);
  applyPlan(baseDir, plan);
  return {
    pending: bids.filter((b) => classifyBid(b.status) === "pending").length,
    awarded: bids.filter((b) => classifyBid(b.status) === "awarded").length,
    moved: plan.moves.length,
    created: plan.creates.length,
    deleted: plan.deletes.length,
  };
}
