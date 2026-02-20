#!/usr/bin/env node
/**
 * Generate demo screenshots and animated GIF for README.
 *
 * Not part of the main package — runs in CI or locally with:
 *   npx playwright install chromium
 *   node scripts/generate-demo.mjs
 *
 * Requirements: playwright (npx/global), ffmpeg, git
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Dynamic import — playwright is NOT a project dependency
const { chromium } = await import("playwright");

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = dirname(__dirname);
const DOCS_DIR = join(REPO_DIR, "docs");
const TMP = mkdtempSync(join(tmpdir(), "ccsl-demo-"));
const CCSL_BIN = join(REPO_DIR, "dist/bin/ccsl.js");

const CONFIG_PATH = join(process.env.HOME, ".claude/statusline-config.json");
let configBackup;
try { configBackup = readFileSync(CONFIG_PATH, "utf8"); } catch { configBackup = null; }
let httpServer = null;

function cleanup() {
    if (configBackup !== null) writeFileSync(CONFIG_PATH, configBackup);
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
    if (httpServer) { httpServer.close(); httpServer = null; }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();
}

// ─── Fake git repo ──────────────────────────────────────────────────────────

console.log("==> Creating demo git repo");
const DEMO_REPO = join(TMP, "example-project");
mkdirSync(join(DEMO_REPO, "src"), { recursive: true });
run("git", ["init", "-q"], { cwd: DEMO_REPO });
run("git", ["checkout", "-q", "-b", "master"], { cwd: DEMO_REPO });
writeFileSync(join(DEMO_REPO, "src/app.ts"), "export const app = {};");
writeFileSync(join(DEMO_REPO, "src/db.ts"), "export const db = {};");
run("git", ["-C", DEMO_REPO, "add", "-A"]);
run("git", ["-C", DEMO_REPO, "commit", "-q", "-m", "init"]);
run("git", ["-C", DEMO_REPO, "checkout", "-q", "-b", "feature/user-auth"]);
writeFileSync(join(DEMO_REPO, "src/auth.ts"), "export const auth = {};");
run("git", ["-C", DEMO_REPO, "add", "-A"]);
run("git", ["-C", DEMO_REPO, "commit", "-q", "-m", "add files"]);
writeFileSync(join(DEMO_REPO, "src/auth.ts"), "export const auth = {};\n// modified");
writeFileSync(join(DEMO_REPO, "src/routes.ts"), "");
writeFileSync(join(DEMO_REPO, ".env.example"), "API_KEY=");

// ─── Rich demo transcript ───────────────────────────────────────────────────

console.log("==> Generating demo transcript");
const TRANSCRIPT = join(TMP, "transcript.jsonl");
const TS = "2026-02-20T10:00:00Z";
let tid = 0;
const tlines = [];

function emit(name, input) {
    tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_use", id: `t${tid}`, name, input }] } }));
    tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_result", tool_use_id: `t${tid}` }] } }));
    tid += 2;
}

for (const f of ["types","utils","render","main","config","api","helpers"]) emit("Read", { file_path: `/src/${f}.ts` });
for (const p of ["export function","interface","import.*from","TODO"]) emit("Grep", { pattern: p });
emit("Glob", { pattern: "**/*.ts" }); emit("Glob", { pattern: "**/*.test.ts" }); emit("Glob", { pattern: "src/**/*.tsx" });
for (const f of ["types","render","utils","main","config","render","api"]) emit("Edit", { file_path: `/src/${f}.ts` });
for (const f of ["new-module","tests/new-module.test","validators","tests/validators.test"]) emit("Write", { file_path: `/${f}.ts` });
for (const c of ["npm run build","npm test","git status","git diff --stat","git add -A && git commit -m 'feat: add module'","npm run lint","npm run typecheck","npx tsc --noEmit"]) emit("Bash", { command: c });
emit("WebSearch", { query: "typescript best practices 2026" });

// Task agents
tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_use", id: `t${tid}`, name: "Task", input: { subagent_type: "feature-dev:code-reviewer", description: "Review auth implementation", prompt: "Review" } }] } }));
tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_result", tool_use_id: `t${tid}` }] } })); tid += 2;
tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_use", id: `t${tid}`, name: "Task", input: { subagent_type: "general-purpose", description: "Generate test fixtures", prompt: "Generate" } }] } }));
tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_result", tool_use_id: `t${tid}` }] } })); tid += 2;

for (const t of ["browser_navigate","browser_snapshot","browser_click","browser_take_screenshot","browser_fill_form","browser_evaluate"]) emit(`mcp__plugin_playwright_playwright__${t}`, {});
emit("mcp__plugin_context7_context7__resolve-library-id", { libraryName: "react" });
emit("mcp__plugin_context7_context7__query-docs", { libraryId: "/facebook/react" });
emit("mcp__plugin_context7_context7__query-docs", { libraryId: "/vercel/next.js" });
emit("Skill", { skill: "commit" }); emit("ToolSearch", { query: "playwright" });

tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_use", id: "todo1", name: "TodoWrite", input: { todos: [
    { subject: "Extract types into separate module", status: "completed" },
    { subject: "Refactor render pipeline", status: "completed" },
    { subject: "Add rate limiting", status: "in_progress" },
    { subject: "Write unit tests", status: "pending" },
    { subject: "Update documentation", status: "pending" },
    { subject: "Performance benchmarks", status: "pending" },
] } }] } }));
tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_result", tool_use_id: "todo1" }] } }));
tlines.push(JSON.stringify({ timestamp: TS, message: { content: [{ type: "tool_use", id: "running1", name: "Bash", input: { command: "npm test -- --coverage --watch" } }] } }));

writeFileSync(TRANSCRIPT, tlines.join("\n") + "\n");

// ─── Render ANSI ────────────────────────────────────────────────────────────

console.log("==> Rendering all layout variants");
const RENDERS = join(TMP, "renders");
mkdirSync(RENDERS);

const INPUT = JSON.stringify({
    hook_event_name: "Status", session_id: "demo",
    transcript_path: TRANSCRIPT, cwd: DEMO_REPO,
    model: { id: "claude-opus-4-6", display_name: "Opus" },
    workspace: { current_dir: DEMO_REPO, project_dir: DEMO_REPO },
    version: "1.0.80", output_style: { name: "default" },
    cost: { total_cost_usd: 4.82, total_duration_ms: 1854000, total_lines_added: 284, total_lines_removed: 67 },
    context_window: { total_input_tokens: 95000, total_output_tokens: 18000, context_window_size: 200000,
        current_usage: { input_tokens: 28000, cache_creation_input_tokens: 45000, cache_read_input_tokens: 22000 } }
});

const VARIANTS = ["dense", "dense-full", "semantic", "semantic-full", "adaptive", "adaptive-full"];

for (const variant of VARIANTS) {
    const layout = variant.replace("-full", "");
    const features = variant.endsWith("-full");
    const config = { layout, features: { usage: features, learning: features, cctg: features } };
    writeFileSync(CONFIG_PATH, JSON.stringify(config));

    const ansi = run("node", [CCSL_BIN], {
        input: INPUT,
        env: { ...process.env, COLUMNS: "120" },
    });
    writeFileSync(join(RENDERS, `${variant}.ansi`), ansi);
    console.log(`  ${variant}`);
}

// ─── ANSI → HTML ────────────────────────────────────────────────────────────

console.log("==> Converting ANSI to HTML");

function ansiToHtml(text) {
    text = text.replace(/\x1b\[2?K/g, "").replace(/\r/g, "").replace(/^\n+|\n+$/g, "");
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    let result = "", i = 0, fg = null, bg = null, inLink = false;

    function style() {
        const p = [];
        if (fg) p.push(`color:${fg}`);
        if (bg) p.push(`background:${bg};border-radius:3px`);
        return p.join(";");
    }

    while (i < text.length) {
        if (text.slice(i, i + 4) === "\x1b]8;") {
            let end = text.indexOf("\x07", i);
            let endSt = text.indexOf("\x1b\\", i);
            let osc, next;
            if (end >= 0 && (endSt < 0 || end < endSt)) { osc = text.slice(i + 2, end); next = end + 1; }
            else if (endSt >= 0) { osc = text.slice(i + 2, endSt); next = endSt + 2; }
            else { result += esc(text[i]); i++; continue; }
            i = next;
            const url = (osc.split(";")[2]) || "";
            if (url) {
                if (inLink) result += "</span></a>";
                inLink = true;
                const s = style();
                result += `<a href="${esc(url)}" style="text-decoration:none"><span${s ? ` style="${s}"` : ""}>`;
            } else if (inLink) { result += "</span></a>"; inLink = false; }
            continue;
        }
        if (text.slice(i, i + 2) === "\x1b[") {
            const end = text.indexOf("m", i);
            if (end < 0) { result += esc(text[i]); i++; continue; }
            const params = (text.slice(i + 2, end) || "0").split(";");
            i = end + 1;
            result += "</span>";
            let j = 0;
            while (j < params.length) {
                const p = parseInt(params[j]) || 0;
                if (p === 0) { fg = bg = null; }
                else if (p === 39) fg = null;
                else if (p === 49) bg = null;
                else if (p === 97) fg = "#e1e4ed";
                else if (p === 38 && j + 4 < params.length && params[j + 1] === "2") {
                    fg = `#${(+params[j+2]).toString(16).padStart(2,"0")}${(+params[j+3]).toString(16).padStart(2,"0")}${(+params[j+4]).toString(16).padStart(2,"0")}`;
                    j += 4;
                } else if (p === 48 && j + 4 < params.length && params[j + 1] === "2") {
                    bg = `#${(+params[j+2]).toString(16).padStart(2,"0")}${(+params[j+3]).toString(16).padStart(2,"0")}${(+params[j+4]).toString(16).padStart(2,"0")}`;
                    j += 4;
                }
                j++;
            }
            const s = style();
            result += `<span${s ? ` style="${s}"` : ""}>`;
            continue;
        }
        result += esc(text[i]); i++;
    }
    if (inLink) result += "</span></a>";
    result += "</span>";
    return result;
}

const htmlTemplate = body => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { background:#1a1b26; margin:0; padding:14px 16px;
  font-family:'JetBrains Mono','Fira Code','SF Mono','Menlo',monospace;
  font-size:13px; line-height:1.5; color:#c0caf5; }
pre { margin:0; white-space:pre; font:inherit; }
a { color:inherit; }
</style></head><body><pre>${body}</pre></body></html>`;

for (const v of VARIANTS) {
    const ansi = readFileSync(join(RENDERS, `${v}.ansi`), "utf8");
    writeFileSync(join(RENDERS, `${v}.html`), htmlTemplate(ansiToHtml(ansi)));
}

// ─── Screenshot with Playwright ─────────────────────────────────────────────

console.log("==> Taking screenshots with Playwright");

await new Promise((resolve, reject) => {
    httpServer = createServer((req, res) => {
        try {
            const content = readFileSync(join(RENDERS, req.url.slice(1)));
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(content);
        } catch { res.writeHead(404); res.end(); }
    });
    httpServer.listen(18765, resolve);
    httpServer.on("error", reject);
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1100, height: 600 });

const SCREENSHOTS = join(TMP, "screenshots");
mkdirSync(SCREENSHOTS);
mkdirSync(DOCS_DIR, { recursive: true });

for (const v of VARIANTS) {
    await page.goto(`http://localhost:18765/${v}.html`);
    await page.waitForTimeout(200);
    const pre = await page.locator("pre").boundingBox();
    await page.screenshot({
        path: join(SCREENSHOTS, `${v}.png`),
        clip: { x: 0, y: 0, width: Math.ceil(pre.x + pre.width + 16), height: Math.ceil(pre.y + pre.height + 14) },
        type: "png",
    });
    console.log(`  ${v}.png`);
}

await browser.close();
httpServer.close(); httpServer = null;

// ─── Animated GIF ───────────────────────────────────────────────────────────

console.log("==> Building animated GIF");

let maxW = 0, maxH = 0;
for (const v of VARIANTS) {
    const dims = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", join(SCREENSHOTS, `${v}.png`)]);
    const [w, h] = dims.split("x").map(Number);
    if (w > maxW) maxW = w;
    if (h > maxH) maxH = h;
}

const ffmpegArgs = [];
for (const v of VARIANTS) ffmpegArgs.push("-loop", "1", "-t", "3", "-i", join(SCREENSHOTS, `${v}.png`));

const pads = VARIANTS.map((_, i) => `[${i}]pad=${maxW}:${maxH}:0:0:color=#1a1b26[v${i}]`).join(";");
const concatIn = VARIANTS.map((_, i) => `[v${i}]`).join("");
const filter = `${pads};${concatIn}concat=n=${VARIANTS.length}:v=1:a=0[out];[out]split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=single[pal];[s1][pal]paletteuse=dither=bayer:bayer_scale=3`;

ffmpegArgs.push("-filter_complex", filter, "-y", join(DOCS_DIR, "demo.gif"));
execFileSync("ffmpeg", ffmpegArgs, { stdio: "ignore" });

const size = run("ls", ["-lh", join(DOCS_DIR, "demo.gif")]).split(/\s+/)[4];
console.log(`==> Done! docs/demo.gif: ${size}`);
