/*
 * Freelancer bridge for the OpenCode desktop main process.
 *
 * Added to resources/app.asar as out/main/freelancer-main.js and loaded by the
 * shared entry out/main/oc-addons.js (see apply.js). It registers a few IPC
 * handlers:
 *
 *   freelancer-status -> { ok, valid }  token present + still valid
 *   freelancer-login  -> { ok }         validate + store a Personal Access Token
 *   freelancer-logout -> { ok }         clear the stored token
 *   freelancer-sync   -> { ok, summary } keep the local folders in sync with bids
 *
 * The token is entered once by the user (renderer modal) and stored locally in
 * the OpenCode user data folder, so no re-login is needed afterwards. fs + net
 * live here because the renderer/preload are sandboxed (no fs/net, and the
 * Freelancer API has no CORS for the oc:// renderer).
 */
import { app, ipcMain, net } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSync } from "./freelancer-sync.mjs";

const API = "https://www.freelancer.com/api";
const DEFAULT_DIR = "C:\\Users\\10293\\Desktop\\Repos\\Freelancer";

let token = null;

function tokenFile() { return join(app.getPath("userData"), "freelancer-session.json"); }

function loadToken() {
  if (token) return token;
  try {
    const parsed = JSON.parse(readFileSync(tokenFile(), "utf8"));
    if (parsed && typeof parsed.token === "string") token = parsed.token;
  } catch (e) { /* no stored token */ }
  return token;
}
function saveToken(value) {
  token = value;
  try { writeFileSync(tokenFile(), JSON.stringify({ token: value, at: Date.now() })); } catch (e) { /* ignore */ }
}
function clearToken() {
  token = null;
  try { writeFileSync(tokenFile(), "{}"); } catch (e) { /* ignore */ }
}

async function validate(value) {
  try {
    const res = await net.fetch(API + "/users/0.1/self", { headers: { "freelancer-oauth-v1": value } });
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    const json = await res.json();
    if (json && json.status === "success") return { ok: true, id: json.result && json.result.id };
    return { ok: false, error: (json && (json.message || json.error_code)) || "invalid" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

ipcMain.handle("freelancer-status", async () => {
  loadToken();
  if (!token) return { ok: false, valid: false };
  const check = await validate(token);
  return check.ok ? { ok: true, valid: true } : { ok: false, valid: false };
});

ipcMain.handle("freelancer-login", async (_event, value) => {
  const clean = typeof value === "string" ? value.trim() : "";
  if (clean.length < 8) return { ok: false, error: "invalid token" };
  const check = await validate(clean);
  if (!check.ok) return check;
  saveToken(clean);
  return { ok: true };
});

ipcMain.handle("freelancer-logout", async () => {
  clearToken();
  return { ok: true };
});

ipcMain.handle("freelancer-sync", async () => {
  const current = loadToken();
  if (!current) return { ok: false, error: "not_authenticated" };
  try {
    const dir = process.env.FREELANCER_DIR || DEFAULT_DIR;
    const summary = await runSync(dir, current, API);
    return { ok: true, summary: summary, dir: dir };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
