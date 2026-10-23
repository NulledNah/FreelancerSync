#!/usr/bin/env node
/*
 * apply.js - install / remove the Freelancer sync button into the OpenCode desktop app.
 *
 * This addon shares the append-only main entry out/main/oc-addons.js with the
 * other addons (see README.md / whatsNew.md in the DeepSeek addon). install
 * appends:
 *   + out/main/freelancer-sync.mjs    (pure sync logic: fetch bids + reconcile folders)
 *   + out/main/freelancer-main.js     (IPC handlers: status / login / sync)
 *   + out/renderer/freelancer-panel.js(the rail button UI)
 *   + out/main/oc-addons.js           (shared loader, only if absent)
 *   ~ package.json                    (main -> ./out/main/oc-addons.js)
 *   ~ out/preload/index.js            (expose window.api.freelancer*)
 *   ~ out/renderer/index.html         (<script src="./freelancer-panel.js">)
 *
 * Existing data is never moved (only appended). remove neutralizes this addon
 * (its main module becomes an empty stub) and strips its renderer script tag /
 * preload lines, without touching other addons. restore-all copies the shared
 * pristine backup back over app.asar. Run while OpenCode is closed.
 *
 *   node apply.js install|remove|restore-all|status|verify [--app <dir>] [--force]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const SHARED_BACKUP_SUFFIX = ".ocaddons-backup";
const BLOCK_SIZE = 4194304;
const MARKER = "freelancer-panel.js";
const SCRIPT_TAG = '<script src="./freelancer-panel.js" defer></script>';
const REMOVED_SENTINEL = "/* oc-addon-removed: freelancer */";

const SYNC_PARTS = ["out", "main", "freelancer-sync.mjs"];
const MAIN_PARTS = ["out", "main", "freelancer-main.js"];
const PANEL_PARTS = ["out", "renderer", "freelancer-panel.js"];
const PRELOAD_PARTS = ["out", "preload", "index.js"];
const INDEX_PARTS = ["out", "renderer", "index.html"];
const PKG_PARTS = ["package.json"];
const LOADER_PARTS = ["out", "main", "oc-addons.js"];
const LOADER_MAIN = "./out/main/oc-addons.js";
const BASE_MAIN = "./out/main/index.js";

// Shared loader entry. Keep byte-identical to the DeepSeek apply.js: whichever
// addon installs first creates it, the others reuse it as-is.
const LOADER_SRC =
  "/* oc-addons loader - shared entry for OpenCode desktop addons.\n" +
  " * Loads the base app, then any present addon main module. Addons are\n" +
  " * append-only; a removed addon is neutralized to a no-op stub. */\n" +
  'import "./index.js";\n' +
  'for (const f of ["./deepseek-main.js", "./freelancer-main.js"]) {\n' +
  "  try { await import(f); } catch (e) { /* addon not installed */ }\n" +
  "}\n";

function parseArgs(argv) {
  const args = { cmd: "install", app: null, force: false };
  const rest = argv.slice(2);
  if (rest[0] && !rest[0].startsWith("-")) args.cmd = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--app") args.app = rest[++i];
    else if (rest[i] === "--force") args.force = true;
  }
  return args;
}

function defaultAppDir() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    return path.join(base, "Programs", "@opencode-aidesktop");
  }
  if (process.platform === "darwin") return "/Applications/OpenCode.app";
  return "/opt/OpenCode";
}

function resolveAsar(appDir) {
  let base = appDir;
  if (process.platform === "darwin" && fs.existsSync(path.join(appDir, "Contents", "Resources"))) {
    base = path.join(appDir, "Contents", "Resources");
  }
  return path.join(base, "resources", "app.asar");
}

function appRunning() {
  if (process.platform !== "win32") return false;
  try {
    return /OpenCode\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq OpenCode.exe" /NH', { encoding: "utf8" }));
  } catch (e) { return false; }
}

function integrityOf(buf) {
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + BLOCK_SIZE)).digest("hex"));
  }
  if (blocks.length === 0) blocks.push(hash);
  return { algorithm: "SHA256", hash, blockSize: BLOCK_SIZE, blocks };
}

function readHeader(asar) {
  const fd = fs.openSync(asar, "r");
  try {
    const sb = Buffer.alloc(8);
    fs.readSync(fd, sb, 0, 8, 0);
    const size = sb.readUInt32LE(4);
    if (size <= 0 || size > fs.fstatSync(fd).size - 8) throw new Error("app.asar header non valido");
    const hb = Buffer.alloc(size);
    fs.readSync(fd, hb, 0, size, 8);
    const strLen = hb.readUInt32LE(4);
    return { size, json: JSON.parse(hb.subarray(8, 8 + strLen).toString("utf8")), dataStart: 8 + size };
  } finally {
    fs.closeSync(fd);
  }
}

function nodeAt(json, parts) {
  let n = json;
  for (const p of parts) { if (!n || !n.files || !n.files[p]) return null; n = n.files[p]; }
  return n;
}
function setEntry(json, parts, entry) {
  const parent = nodeAt(json, parts.slice(0, -1));
  if (!parent || !parent.files) throw new Error("percorso asar non trovato: " + parts.join("/"));
  parent.files[parts[parts.length - 1]] = entry;
}
function readEntry(asar, json, dataStart, parts) {
  const node = nodeAt(json, parts);
  if (!node || node.files) return null;
  const fd = fs.openSync(asar, "r");
  try {
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, dataStart + parseInt(node.offset));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function pickleUInt32(value) {
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(value, 0);
  const out = Buffer.alloc(8);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}
function pickleString(str) {
  const bytes = Buffer.from(str, "utf8");
  const pad = (4 - (bytes.length % 4)) % 4;
  const payload = Buffer.alloc(4 + bytes.length + pad);
  payload.writeUInt32LE(bytes.length, 0);
  bytes.copy(payload, 4);
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

function stripIndex(html) {
  return html.replace(/<script[^>]*src=["']\.\/freelancer-panel\.js["'][^>]*><\/script>/g, "");
}
function patchIndexHtml(html) {
  let out = stripIndex(html);
  if (out.includes("</body>")) out = out.replace("</body>", SCRIPT_TAG + "</body>");
  else out += SCRIPT_TAG;
  return out;
}

function patchPreload(src, add) {
  // Drop any previously injected freelancer line so the patch stays idempotent.
  src = src.split("\n").filter((line) => !/freelancer(Status|Login|Logout|Sync)\s*:/.test(line)).join("\n");
  if (!add) return src;
  const needle = 'electron.contextBridge.exposeInMainWorld("api", api)';
  if (!src.includes(needle)) throw new Error("preload: punto di innesto non trovato");
  const inject =
    'Object.assign(api,{freelancerStatus:()=>electron.ipcRenderer.invoke("freelancer-status"),' +
    'freelancerLogin:(t)=>electron.ipcRenderer.invoke("freelancer-login",t),' +
    'freelancerLogout:()=>electron.ipcRenderer.invoke("freelancer-logout"),' +
    'freelancerSync:()=>electron.ipcRenderer.invoke("freelancer-sync")});\n';
  return src.replace(needle, inject + needle);
}

function panelVersion() {
  try {
    const v = fs.readFileSync(path.join(__dirname, "VERSION"), "utf8").trim();
    if (v) return v;
  } catch (e) { /* no VERSION file */ }
  return "dev";
}

function sharedBackup(asar) { return asar + SHARED_BACKUP_SUFFIX; }

function pkgMainOf(asar) {
  try {
    const header = readHeader(asar);
    const raw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
    return raw ? JSON.parse(raw.toString("utf8")).main : null;
  } catch (e) { return null; }
}

// Ensure a pristine copy of app.asar exists for restore-all. If the DeepSeek
// addon is already installed it seeded the shared backup, so this is a no-op.
function ensureSharedBackup(asar) {
  const shared = sharedBackup(asar);
  if (fs.existsSync(shared)) return shared;
  if (pkgMainOf(asar) === BASE_MAIN) {
    fs.copyFileSync(asar, shared);
    console.log("Backup condiviso creato da app.asar (pristino)");
    return shared;
  }
  const legacy = asar + ".deepseek-backup";
  if (fs.existsSync(legacy) && pkgMainOf(legacy) === BASE_MAIN) {
    fs.copyFileSync(legacy, shared);
    console.log("Backup condiviso creato da " + legacy);
    return shared;
  }
  console.warn("Nessun backup pristino trovato: 'restore-all' non sara' possibile finche' non ne esiste uno.");
  return null;
}

function install(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  if (!fs.existsSync(asar)) { console.error("app.asar non trovato: " + asar); process.exit(1); }
  if (appRunning() && !args.force) {
    console.error("OpenCode e' in esecuzione. Chiudilo prima di applicare la patch (oppure usa --force).");
    process.exit(1);
  }

  const syncSrc = path.join(__dirname, "freelancer-sync.mjs");
  const mainSrc = path.join(__dirname, "freelancer-main.js");
  const panelSrc = path.join(__dirname, "freelancer-panel.js");
  for (const f of [syncSrc, mainSrc, panelSrc]) {
    if (!fs.existsSync(f)) { console.error(path.basename(f) + " non trovato accanto ad apply.js"); process.exit(1); }
  }
  ensureSharedBackup(asar);

  const header = readHeader(asar);
  const pkgRaw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
  const preloadRaw = readEntry(asar, header.json, header.dataStart, PRELOAD_PARTS);
  const indexRaw = readEntry(asar, header.json, header.dataStart, INDEX_PARTS);
  if (!pkgRaw || !preloadRaw || !indexRaw) { console.error("file attesi non trovati nell'asar"); process.exit(1); }

  const syncBuf = fs.readFileSync(syncSrc);
  const mainBuf = fs.readFileSync(mainSrc);
  const panelBuf = Buffer.from(
    fs.readFileSync(panelSrc, "utf8").replace("__FREELANCER_PANEL_VERSION__", panelVersion()),
    "utf8"
  );
  const preloadBuf = Buffer.from(patchPreload(preloadRaw.toString("utf8"), true), "utf8");
  const indexBuf = Buffer.from(patchIndexHtml(indexRaw.toString("utf8")), "utf8");
  const pkg = JSON.parse(pkgRaw.toString("utf8"));
  pkg.main = LOADER_MAIN;
  const pkgBuf = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");

  const needLoader = !nodeAt(header.json, LOADER_PARTS);
  const full = fs.readFileSync(asar);
  const dataBuf = full.subarray(header.dataStart);
  let cursor = dataBuf.length;
  const appended = [];
  const add = (parts, buf) => {
    setEntry(header.json, parts, { size: buf.length, offset: String(cursor), integrity: integrityOf(buf) });
    cursor += buf.length;
    appended.push(buf);
  };
  add(SYNC_PARTS, syncBuf);
  add(MAIN_PARTS, mainBuf);
  add(PANEL_PARTS, panelBuf);
  if (needLoader) add(LOADER_PARTS, Buffer.from(LOADER_SRC, "utf8"));
  add(PRELOAD_PARTS, preloadBuf);
  add(INDEX_PARTS, indexBuf);
  add(PKG_PARTS, pkgBuf);

  const newData = Buffer.concat([dataBuf].concat(appended));
  const headerBytes = pickleString(JSON.stringify(header.json));
  const output = Buffer.concat([pickleUInt32(headerBytes.length), headerBytes, newData]);

  const tmp = asar + ".freelancer-new";
  fs.writeFileSync(tmp, output);
  const check = readHeader(tmp);
  if (!nodeAt(check.json, MAIN_PARTS) || !nodeAt(check.json, PANEL_PARTS) || !nodeAt(check.json, LOADER_PARTS)) {
    throw new Error("validazione del nuovo app.asar fallita");
  }
  fs.renameSync(tmp, asar);

  console.log("Patch applicata: " + asar);
  console.log("Riavvia OpenCode. Il pulsante Freelancer e' nella barra del prompt, dopo modello/effort.");
  console.log("Per rimuoverlo: node apply.js remove (solo Freelancer) o restore-all (tutti gli addon).");
}

function remove(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  if (!fs.existsSync(asar)) { console.error("app.asar non trovato: " + asar); process.exit(1); }
  if (appRunning() && !args.force) {
    console.error("OpenCode e' in esecuzione. Chiudilo prima di rimuovere (oppure usa --force).");
    process.exit(1);
  }
  const header = readHeader(asar);
  const pkgRaw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
  const preloadRaw = readEntry(asar, header.json, header.dataStart, PRELOAD_PARTS);
  const indexRaw = readEntry(asar, header.json, header.dataStart, INDEX_PARTS);
  if (!pkgRaw || !preloadRaw || !indexRaw) { console.error("file attesi non trovati nell'asar"); process.exit(1); }

  const hasLoader = !!nodeAt(header.json, LOADER_PARTS);
  const pkg = JSON.parse(pkgRaw.toString("utf8"));
  // Keep the shared loader as entry when present so other addons keep working.
  pkg.main = hasLoader ? LOADER_MAIN : BASE_MAIN;
  const pkgBuf = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");
  const stubBuf = Buffer.from(REMOVED_SENTINEL + "\n", "utf8");
  const preloadBuf = Buffer.from(patchPreload(preloadRaw.toString("utf8"), false), "utf8");
  const indexBuf = Buffer.from(stripIndex(indexRaw.toString("utf8")), "utf8");

  const full = fs.readFileSync(asar);
  const dataBuf = full.subarray(header.dataStart);
  let cursor = dataBuf.length;
  const appended = [];
  const add = (parts, buf) => {
    setEntry(header.json, parts, { size: buf.length, offset: String(cursor), integrity: integrityOf(buf) });
    cursor += buf.length;
    appended.push(buf);
  };
  add(MAIN_PARTS, stubBuf);
  add(PRELOAD_PARTS, preloadBuf);
  add(INDEX_PARTS, indexBuf);
  add(PKG_PARTS, pkgBuf);

  const newData = Buffer.concat([dataBuf].concat(appended));
  const headerBytes = pickleString(JSON.stringify(header.json));
  const output = Buffer.concat([pickleUInt32(headerBytes.length), headerBytes, newData]);
  const tmp = asar + ".freelancer-new";
  fs.writeFileSync(tmp, output);
  readHeader(tmp);
  fs.renameSync(tmp, asar);
  console.log("Freelancer rimosso (modulo neutralizzato, entry preservato).");
  console.log("Riavvia OpenCode.");
}

function restoreAll(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const shared = sharedBackup(asar);
  const legacy = asar + ".deepseek-backup";
  const src = fs.existsSync(shared) ? shared : (fs.existsSync(legacy) ? legacy : null);
  if (!src) { console.error("Nessun backup trovato (" + shared + ")."); process.exit(1); }
  if (appRunning() && !args.force) {
    console.error("OpenCode e' in esecuzione. Chiudilo prima di ripristinare (oppure usa --force).");
    process.exit(1);
  }
  const tmp = asar + ".freelancer-restore";
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, asar);
  console.log("app.asar originale ripristinato da: " + src);
  console.log("Tutti gli addon (DeepSeek e Freelancer) sono stati rimossi.");
}

function status(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const shared = sharedBackup(asar);
  console.log("Install dir  : " + appDir);
  console.log("app.asar     : " + (fs.existsSync(asar) ? "ok" : "MANCANTE"));
  console.log("backup shared: " + (fs.existsSync(shared) ? shared : "assente"));
  if (fs.existsSync(asar)) {
    const header = readHeader(asar);
    const pkg = JSON.parse(readEntry(asar, header.json, header.dataStart, PKG_PARTS).toString("utf8"));
    const mainNode = nodeAt(header.json, MAIN_PARTS);
    const neutral = mainNode ? readEntry(asar, header.json, header.dataStart, MAIN_PARTS).toString("utf8").includes("oc-addon-removed") : false;
    console.log("main         : " + pkg.main);
    console.log("loader       : " + (nodeAt(header.json, LOADER_PARTS) ? "presente" : "assente"));
    console.log("freelancer   : " + (neutral ? "rimosso (stub)" : (mainNode ? "installato" : "assente")));
  }
  console.log("in esecuzione: " + (appRunning() ? "si" : "no"));
}

function verify(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const header = readHeader(asar);
  const pkg = JSON.parse(readEntry(asar, header.json, header.dataStart, PKG_PARTS).toString("utf8"));
  const preload = readEntry(asar, header.json, header.dataStart, PRELOAD_PARTS).toString("utf8");
  const index = readEntry(asar, header.json, header.dataStart, INDEX_PARTS).toString("utf8");
  const main = readEntry(asar, header.json, header.dataStart, MAIN_PARTS);
  const panel = readEntry(asar, header.json, header.dataStart, PANEL_PARTS);
  if (pkg.main !== LOADER_MAIN) throw new Error("package.json main non e' il loader condiviso");
  if (!nodeAt(header.json, LOADER_PARTS)) throw new Error("oc-addons.js (loader) mancante");
  if (!nodeAt(header.json, SYNC_PARTS)) throw new Error("freelancer-sync.mjs mancante");
  if (!preload.includes("freelancerLogin")) throw new Error("preload: bridge freelancer mancante");
  if (!index.includes(MARKER)) throw new Error("index.html: script tag mancante");
  if (!main || !main.toString("utf8").includes("freelancer-sync")) throw new Error("freelancer-main.js mancante/invalido");
  if (!panel || !panel.toString("utf8").includes("__freelancerPanelLoaded")) throw new Error("freelancer-panel.js mancante/invalido");
  console.log("verify ok: loader + entry + preload + index + panel (" + panel.length + " byte) + main (" + main.length + " byte)");
}

const args = parseArgs(process.argv);
try {
  if (args.cmd === "install") install(args);
  else if (args.cmd === "remove") remove(args);
  else if (args.cmd === "restore" || args.cmd === "restore-all") restoreAll(args);
  else if (args.cmd === "status") status(args);
  else if (args.cmd === "verify") verify(args);
  else { console.error("Comando sconosciuto: " + args.cmd); process.exit(1); }
} catch (err) {
  console.error("Errore: " + (err && err.message ? err.message : err));
  process.exit(1);
}
