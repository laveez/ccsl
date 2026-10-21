#!/usr/bin/env node
/**
 * Generate badge reference image for README documentation.
 * Shows every badge type in all possible states.
 *
 * Requirements: playwright (npx/global), a build (npm run build)
 * Usage: node scripts/generate-badge-reference.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const { chromium } = await import("playwright");

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = dirname(__dirname);
const DOCS_DIR = join(REPO_DIR, "docs");
const { buildUsage5hBadge, buildUsage7dBadge } = await import(pathToFileURL(join(REPO_DIR, "dist/usage.js")).href);

// Badge color palette (matches BADGE in types.ts)
const C = {
    blue:     [38, 60, 100],
    green:    [38, 75, 48],
    cyan:     [28, 75, 82],
    purple:   [65, 45, 88],
    orange:   [95, 58, 28],
    gold:     [85, 70, 28],
    olive:    [58, 68, 32],
    steel:    [52, 56, 66],
    charcoal: [46, 48, 54],
    rose:     [90, 38, 50],
    barGreen: [50, 110, 50],
    barYellow:[140, 120, 40],
    barRed:   [140, 60, 60],
    barBg:    [45, 48, 55],
};

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

function badge(text, color, extra = "") {
    return `<span class="badge" style="background:${rgb(color)};${extra}">${text}</span>`;
}

function barBadge(prefix, pct, fillColor, text, badgeColor) {
    const w = 80;
    const filled = Math.round(w * pct / 100);
    return `<span class="badge bar-badge" style="background:${rgb(badgeColor)}">` +
        `${prefix} <span class="bar">` +
        `<span class="bar-fill" style="width:${filled}px;background:${rgb(fillColor)}">${text}</span>` +
        `<span class="bar-empty" style="width:${w - filled}px;background:${rgb(C.barBg)}"></span>` +
        `</span></span>`;
}

// The usage bars are drawn cell by cell, so they come from ccsl itself, converted from its ANSI output.
function ansiBadge(ansi) {
    let html = "", fg = null, bg = null;
    for (const part of ansi.split(/(\x1b\[[0-9;]*m)/)) {
        const codes = part.match(/^\x1b\[([0-9;]*)m$/);
        if (!codes) {
            if (part) html += `<span style="${bg ? `background:${bg};` : ""}${fg ? `color:${fg}` : ""}">${part}</span>`;
            continue;
        }
        const p = codes[1].split(";").map(Number);
        for (let i = 0; i < p.length; i++) {
            if (p[i] === 0) fg = bg = null;
            else if (p[i] === 97) fg = "#e1e4ed";
            else if ((p[i] === 38 || p[i] === 48) && p[i + 1] === 2) {
                const color = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`;
                if (p[i] === 38) fg = color; else bg = color;
                i += 4;
            }
        }
    }
    return `<span class="ansi">${html}</span>`;
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
function usage(fiveHour, fiveHourLeft, sevenDay, sevenDayLeft) {
    return {
        fiveHour, sevenDay,
        fiveHourResetAt: new Date(Date.now() + fiveHourLeft),
        sevenDayResetAt: new Date(Date.now() + sevenDayLeft),
    };
}
const usage5h = (used, left, weekly = 10) => ansiBadge(buildUsage5hBadge(usage(used, left, weekly, 3 * DAY))[0]);
const usage7d = (used, left, compact = false) => ansiBadge(buildUsage7dBadge(usage(0, HOUR, used, left), compact)[0]);

function gradient(t, c1, c2) {
    return c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
}

function section(title) {
    return `<div class="section-title">${title}</div>`;
}

function row(label, ...badges) {
    return `<div class="row"><span class="label">${label}</span><span class="badges">${badges.join(" ")}</span></div>`;
}

// Build the reference page
const badges = [];

// ── Identity ──
badges.push(section("Identity"));
badges.push(row("Model / Fast mode",
    badge("Opus", C.blue),
    badge("Sonnet", C.blue),
    badge("Fable | fast", C.blue),
));
badges.push(row("Reasoning effort",
    badge("💭 low", C.steel),
    badge("💭 medium", C.blue),
    badge("💭 high", C.gold),
    badge("💭 xhigh", C.orange),
    badge("💭 max", C.rose),
    badge("💭 off", C.steel),
));
badges.push(row("Agent session",
    badge("🤖 security-reviewer", C.purple),
    badge("🤖 code-explorer", C.purple),
));
badges.push(row("Duration (gradient)",
    badge("⏲ 30s", C.green),
    badge("⏲ 12m", gradient(0.3, C.green, C.gold)),
    badge("⏲ 45m", gradient(0.7, C.green, C.gold)),
    badge("⏲ 1h 30m", gradient(0.5, C.gold, C.purple)),
    badge("⏲ 3h", C.purple),
));
badges.push(row("Cost (gradient)",
    badge("💸 $0.42", C.green),
    badge("💸 $4.82", gradient(0.5, C.green, C.gold)),
    badge("💸 $12", gradient(0.3, C.gold, C.orange)),
    badge("💸 $50", C.orange),
    badge("💸 $123", C.rose),
));

// ── Context ──
badges.push(section("Context"));
badges.push(row("Context window",
    barBadge("🧠", 35, C.barGreen, " 42k=35% ", C.cyan),
    barBadge("🧠", 75, C.barYellow, " 150k=75% ", C.cyan),
    barBadge("🧠", 92, C.barRed, " 184k=92% ", C.cyan),
));
badges.push(row("Cache breakdown",
    badge("🔥 12kr·5kw·800u", C.cyan),
    badge("🔥 45kr·22kw·8ku", C.cyan),
));
badges.push(row("Prompt cache",
    badge("💾 42m·94%", gradient(0.6, C.gold, C.green)),
    badge("💾 9m·91%", gradient(0.6, C.orange, C.gold)),
    badge("💾 2m·88%", C.orange),
    badge("💾 cold·94%", C.steel),
));

// ── Usage ──
badges.push(section("Usage Rate Limits"));
badges.push(row("5h usage (pace)",
    usage5h(16, 2 * HOUR + 43 * MIN),
    usage5h(45, 3 * HOUR),
    usage5h(52, 3 * HOUR),
    usage5h(60, 3 * HOUR + 30 * MIN),
));
badges.push(row("5h usage (limits)",
    usage5h(100, HOUR + 20 * MIN),
    usage5h(30, 2 * HOUR + 10 * MIN, 100),
    usage5h(50, -MIN),
));
badges.push(row("7d usage (pace)",
    usage7d(4, 4 * DAY + 18 * HOUR),
    usage7d(55, 3 * DAY + 4 * HOUR),
    usage7d(70, 4 * DAY),
));
badges.push(row("7d usage (limit, chip)",
    usage7d(100, 2 * DAY + 2 * HOUR),
    usage7d(4, 4 * DAY + 18 * HOUR, true),
    usage7d(70, 4 * DAY, true),
));
badges.push(row("Spend limit",
    badge("💳 $120/$500", gradient(0.48, C.green, C.orange)),
    badge("💳 $314/$500", gradient(0.43, C.orange, C.rose)),
    badge("💳 $460/$500", C.rose),
    badge("💳 63%", gradient(0.43, C.orange, C.rose)),
));

// ── Git ──
badges.push(section("Git"));
badges.push(row("Repo name",
    badge("ccsl", C.green),
    badge("my-project", C.green),
));
badges.push(row("Branch / Worktree",
    badge("🌿 main", C.purple),
    badge("🌿 feature/user-auth", C.green),
    badge("🌳 fix-login", C.cyan),
));
badges.push(row("File stats",
    badge("!3", C.green),
    badge("!1+2?4", C.green),
    badge("!5+3✘1?2", C.green),
));
badges.push(row("Ahead / Behind",
    badge("↑3", C.green),
    badge("↓2", C.green),
    badge("↑5↓1", C.green),
));
badges.push(row("Lines changed",
    badge(`📊 <span style="color:rgb(140,220,140)">+284</span><span style="color:rgb(220,130,130)">-67</span>`, C.olive),
    badge(`📊 <span style="color:rgb(140,220,140)">+42</span>`, C.olive),
));

// ── Config & PR ──
badges.push(section("Config & PR"));
badges.push(row("Config summary",
    badge("📋 2 CLAUDE.md | 3 hooks", C.purple),
    badge("📋 1 CLAUDE.md | 5 MCPs | 3 hooks", C.purple),
));
badges.push(row("Added dirs",
    badge("+1 dir", C.steel),
    badge("+3 dirs", C.steel),
));
badges.push(row("Ticket marker",
    badge("🎫 PROJ-123", C.purple),
    badge("🎫 FE-456", C.purple),
));
badges.push(row("PR link",
    badge("🔗 PR#42 (D)", C.blue),
    badge("🔗 PR#42 (O)", C.blue),
    badge("🔗 PR#42 (A)", C.green),
    badge("🔗 PR#42 (CR)", C.rose),
    badge("🔗 PR#42 (✅)", C.blue),
    badge("🔗 PR#42 (M)", C.purple),
    badge("🔗 PR#42 (C)", C.steel),
    badge("🔗 MR!7 (O)", C.blue),
));

// ── Transcript & Tools ──
badges.push(section("Transcript & Tools"));
badges.push(row("Transcript / Session",
    badge("📝 session-abc.jsonl", C.steel),
    badge("📝 feature-auth-refactor", C.steel),
));
badges.push(row("Running tool",
    badge("◐ Bash: npm test --coverage", C.cyan),
    badge("◐ Read: src/types.ts", C.cyan),
    badge("◐ Grep", C.cyan),
));
badges.push(row("Completed tools",
    badge("Read×12", C.green),
    badge("Grep×6", C.purple),
    badge("Edit×7", C.green),
    badge("Bash×8", C.orange),
    badge("WebSearch×1", C.cyan),
    badge("Skill×2", C.blue),
));
badges.push(row("MCP tools",
    badge("🔌playwright×6", C.steel),
    badge("🔌context7×3", C.steel),
));

// ── Agents ──
badges.push(section("Agents"));
badges.push(row("Running agent",
    badge("◐ feature Review auth implem… 2m 30s", C.cyan),
));
badges.push(row("Completed agents",
    badge("✓ feature Review auth implementatio… 2m", C.steel),
    badge("✓ general Generate test fixtures 30s", C.steel),
));

// ── Tasks ──
badges.push(section("Tasks"));
badges.push(row("In-progress task",
    badge("▸ Add rate limiting (3/6)", C.cyan),
));
badges.push(row("Pending task",
    badge("▹ Write unit tests (3/6)", C.charcoal),
));
badges.push(row("All completed",
    badge("✓ All done (6/6)", C.green),
));

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body {
    background: #1a1b26;
    margin: 0;
    padding: 20px 24px;
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    color: #c0caf5;
}
.section-title {
    color: #7aa2f7;
    font-size: 13px;
    font-weight: bold;
    margin: 16px 0 6px 0;
    padding-bottom: 3px;
    border-bottom: 1px solid #2a2d3a;
}
.section-title:first-child { margin-top: 0; }
.row {
    display: flex;
    align-items: center;
    margin: 4px 0;
    gap: 10px;
}
.label {
    width: 160px;
    flex-shrink: 0;
    color: #565f89;
    font-size: 11.5px;
}
.badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}
.badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 3px;
    color: #e1e4ed;
    white-space: nowrap;
    font-size: 12px;
}
.bar-badge {
    gap: 4px;
}
.ansi {
    white-space: pre;
    font-size: 12px;
    color: #e1e4ed;
}
.bar {
    display: inline-flex;
    border-radius: 2px;
    overflow: hidden;
}
.bar-fill, .bar-empty {
    display: inline-block;
    height: 14px;
    line-height: 14px;
    font-size: 10px;
    color: #e1e4ed;
    text-align: left;
    padding: 0 2px;
}
.feature-tag {
    font-size: 10px;
    font-weight: normal;
    color: #565f89;
    font-style: italic;
}
</style></head><body>
${badges.join("\n")}
</body></html>`;

const tmpHtml = join(tmpdir(), "ccsl-badge-ref.html");
writeFileSync(tmpHtml, html);

// Screenshot
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1000, height: 2000 });
await page.goto(`file://${tmpHtml}`);
await page.waitForTimeout(200);

const body = await page.locator("body").boundingBox();
mkdirSync(DOCS_DIR, { recursive: true });

await page.screenshot({
    path: join(DOCS_DIR, "badge-reference.png"),
    clip: { x: 0, y: 0, width: Math.ceil(body.width), height: Math.ceil(body.y + body.height) },
    type: "png",
    scale: "device",
});

await browser.close();
console.log("==> Done! docs/badge-reference.png");
