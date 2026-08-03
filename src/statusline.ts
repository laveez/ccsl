import { execFile, execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, createReadStream } from "node:fs";
import { promisify } from "node:util";
import process from "node:process";
import * as readline from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

import type {
    StatuslineInput,
    GitRepoInfo,
    GitFileStats,
    PrInfo,
    TranscriptData,
    AgentEntry,
    TodoItem,
    UnifiedStatuslineData,
    ConfigCounts,
    UsageData,
    CcslConfig,
    RateLimitWindow,
} from "./types.js";
import {
    extractWorktreeName,
    extractRepoName,
    extractRepoNameFromCommonDir,
    getProjectDir,
    getPercentUsed,
} from "./utils.js";
import { buildStatuslineOutput, readStatuslineConfig } from "./render.js";

const execFileP = promisify(execFile);

// ============================================================================
// Git Functions
// ============================================================================

async function getGitFileStats(projectDir: string): Promise<GitFileStats> {
    const stats: GitFileStats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
    try {
        const { stdout } = await execFileP("git", ["-C", projectDir, "status", "--porcelain"]);
        const lines = stdout.trim().split("\n").filter(line => line.length > 0);

        for (const line of lines) {
            const status = line.substring(0, 2);
            if (status.includes("?")) {
                stats.untracked++;
            } else if (status.includes("A")) {
                stats.added++;
            } else if (status.includes("D")) {
                stats.deleted++;
            } else if (status.includes("M") || status.includes("R") || status.includes("C")) {
                stats.modified++;
            }
        }
    } catch {
        // Ignore errors
    }
    return stats;
}

async function getAheadBehind(projectDir: string): Promise<{ ahead: number; behind: number }> {
    try {
        const [aheadResult, behindResult] = await Promise.all([
            execFileP("git", ["-C", projectDir, "rev-list", "--count", "@{u}..HEAD"]),
            execFileP("git", ["-C", projectDir, "rev-list", "--count", "HEAD..@{u}"]),
        ]);
        return {
            ahead: parseInt(aheadResult.stdout.trim(), 10) || 0,
            behind: parseInt(behindResult.stdout.trim(), 10) || 0,
        };
    } catch {
        return { ahead: 0, behind: 0 };
    }
}

async function getCurrentBranch(projectDir: string): Promise<string> {
    try {
        const { stdout } = await execFileP("git", ["-C", projectDir, "rev-parse", "--abbrev-ref", "HEAD"]);
        return stdout.trim();
    } catch {
        return "";
    }
}

async function getLinkedWorktreeCommonDir(projectDir: string): Promise<string | null> {
    try {
        const { stdout: gitDir } = await execFileP("git", ["-C", projectDir, "rev-parse", "--git-dir"]);
        const { stdout: commonDir } = await execFileP("git", ["-C", projectDir, "rev-parse", "--git-common-dir"]);

        const gitDirPath = gitDir.trim();
        const commonDirPath = commonDir.trim();

        if (gitDirPath !== commonDirPath) {
            return commonDirPath;
        }
        return null;
    } catch {
        return null;
    }
}

export async function fetchGitRepoInfo(projectDir: string): Promise<GitRepoInfo | null> {
    try {
        const { stdout: toplevel } = await execFileP("git", ["-C", projectDir, "rev-parse", "--show-toplevel"]);

        const [fileStats, aheadBehind, commonDir, branch] = await Promise.all([
            getGitFileStats(projectDir),
            getAheadBehind(projectDir),
            getLinkedWorktreeCommonDir(projectDir),
            getCurrentBranch(projectDir),
        ]);

        const dirtyFiles = fileStats.modified + fileStats.added + fileStats.deleted + fileStats.untracked;
        const outOfSync = aheadBehind.ahead > 0 || aheadBehind.behind > 0;

        if (commonDir) {
            const repo = extractRepoNameFromCommonDir(commonDir);
            if (repo) {
                const worktree = extractWorktreeName(toplevel);
                return {
                    repo,
                    worktree,
                    dirtyFiles,
                    outOfSync,
                    ahead: aheadBehind.ahead,
                    behind: aheadBehind.behind,
                    fileStats,
                };
            }
        }

        const repo = extractRepoName(toplevel);
        if (!repo) {
            return null;
        }

        return {
            repo,
            branch,
            dirtyFiles,
            outOfSync,
            ahead: aheadBehind.ahead,
            behind: aheadBehind.behind,
            fileStats,
        };
    } catch {
        return null;
    }
}

// ============================================================================
// PR Info
// ============================================================================

// Claude Code supplies PR data natively in the statusline input on recent
// versions — no gh subprocess needed. The native object is absent when there
// is no PR or it is merged/closed.
export function prInfoFromInput(input: StatuslineInput): PrInfo | null {
    if (!input.pr) return null;
    const { number, url, review_state } = input.pr;
    return {
        url,
        number: String(number),
        isDraft: review_state === "draft",
        state: "OPEN",
        reviewDecision: review_state === "approved"
            ? "APPROVED"
            : review_state === "changes_requested" ? "CHANGES_REQUESTED" : undefined,
    };
}

// Fallback for Claude Code versions without the native pr field.
export async function fetchPrInfo(): Promise<PrInfo | null> {
    try {
        const { stdout } = await execFileP(
            "gh", ["pr", "view", "--json=number,url,title,isDraft,state,mergeStateStatus,reviewDecision"],
        );
        const parsed = JSON.parse(stdout);
        return {
            url: parsed.url,
            number: String(parsed.number),
            title: parsed.title,
            isDraft: parsed.isDraft,
            state: parsed.state,
            mergeStateStatus: parsed.mergeStateStatus,
            reviewDecision: parsed.reviewDecision || undefined,
        };
    } catch {
        return null;
    }
}

// ============================================================================
// Transcript Parsing
// ============================================================================

interface TranscriptLine {
    timestamp?: string;
    message?: {
        content?: ContentBlock[];
    };
}

interface ContentBlock {
    type: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    is_error?: boolean;
}

function extractTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
    if (!input) return undefined;

    switch (toolName) {
        case "Read":
        case "Write":
        case "Edit":
            return (input.file_path as string) ?? (input.path as string);
        case "Glob":
        case "Grep":
            return input.pattern as string;
        case "Bash": {
            const cmd = input.command as string;
            return cmd?.slice(0, 30) + (cmd?.length > 30 ? "..." : "");
        }
    }
    return undefined;
}

export async function parseTranscriptFull(transcriptPath: string): Promise<TranscriptData | null> {
    const result: TranscriptData = {
        tools: { running: [], completed: new Map() },
        agents: [],
        todos: [],
    };

    if (!transcriptPath) {
        return result;
    }

    const toolMap = new Map<string, { name: string; target?: string; startTime: Date }>();
    const agentMap = new Map<string, AgentEntry>();
    let latestTodos: TodoItem[] = [];

    try {
        const fileStream = createReadStream(transcriptPath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            if (!line.trim()) continue;

            try {
                const entry = JSON.parse(line) as TranscriptLine;
                const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

                const content = entry.message?.content;
                if (!content || !Array.isArray(content)) continue;

                for (const block of content) {
                    if (block.type === "tool_use" && block.id && block.name) {
                        if (block.name === "Task") {
                            const input = block.input as Record<string, unknown>;
                            const agentEntry: AgentEntry = {
                                id: block.id,
                                type: (input?.subagent_type as string) ?? "unknown",
                                model: (input?.model as string) ?? undefined,
                                description: (input?.description as string) ?? undefined,
                                status: "running",
                                startTime: timestamp,
                            };
                            agentMap.set(block.id, agentEntry);
                        } else if (block.name === "TodoWrite") {
                            const input = block.input as { todos?: Array<{ subject: string; status: string }> };
                            if (input?.todos && Array.isArray(input.todos)) {
                                latestTodos = input.todos.map(t => ({
                                    subject: t.subject,
                                    status: t.status as "pending" | "in_progress" | "completed",
                                }));
                            }
                        } else {
                            toolMap.set(block.id, {
                                name: block.name,
                                target: extractTarget(block.name, block.input),
                                startTime: timestamp,
                            });
                        }
                    }

                    if (block.type === "tool_result" && block.tool_use_id) {
                        const tool = toolMap.get(block.tool_use_id);
                        if (tool) {
                            const count = result.tools.completed.get(tool.name) || 0;
                            result.tools.completed.set(tool.name, count + 1);
                            toolMap.delete(block.tool_use_id);
                        }

                        const agent = agentMap.get(block.tool_use_id);
                        if (agent) {
                            agent.status = "completed";
                            agent.endTime = timestamp;
                        }
                    }
                }
            } catch {
                // Skip malformed lines
            }
        }

        for (const [_id, tool] of toolMap) {
            result.tools.running.push({ name: tool.name, target: tool.target });
        }

        result.agents = Array.from(agentMap.values()).slice(-10);
        result.todos = latestTodos;

        return result;
    } catch {
        return result;
    }
}

// ============================================================================
// Config Counting
// ============================================================================

function getMcpServerNames(filePath: string): Set<string> {
    if (!existsSync(filePath)) return new Set();
    try {
        const content = readFileSync(filePath, "utf8");
        const config = JSON.parse(content);
        if (config.mcpServers && typeof config.mcpServers === "object") {
            return new Set(Object.keys(config.mcpServers));
        }
    } catch {
        // Ignore parse errors
    }
    return new Set();
}

function getDisabledMcpServers(filePath: string, key: string): Set<string> {
    if (!existsSync(filePath)) return new Set();
    try {
        const content = readFileSync(filePath, "utf8");
        const config = JSON.parse(content);
        if (Array.isArray(config[key])) {
            const validNames = config[key].filter((s: unknown) => typeof s === "string");
            return new Set(validNames);
        }
    } catch {
        // Ignore parse errors
    }
    return new Set();
}

function countHooksInFile(filePath: string): number {
    if (!existsSync(filePath)) return 0;
    try {
        const content = readFileSync(filePath, "utf8");
        const config = JSON.parse(content);
        if (config.hooks && typeof config.hooks === "object") {
            return Object.keys(config.hooks).length;
        }
    } catch {
        // Ignore parse errors
    }
    return 0;
}

export function countConfigs(cwd?: string): ConfigCounts {
    let claudeMdCount = 0;
    let hooksCount = 0;

    const homeDir = homedir();
    const claudeDir = join(homeDir, ".claude");

    const userMcpServers = new Set<string>();
    const projectMcpServers = new Set<string>();

    // === USER SCOPE ===
    if (existsSync(join(claudeDir, "CLAUDE.md"))) {
        claudeMdCount++;
    }
    const userSettings = join(claudeDir, "settings.json");
    for (const name of getMcpServerNames(userSettings)) {
        userMcpServers.add(name);
    }
    hooksCount += countHooksInFile(userSettings);

    const userClaudeJson = join(homeDir, ".claude.json");
    for (const name of getMcpServerNames(userClaudeJson)) {
        userMcpServers.add(name);
    }

    const disabledUserMcps = getDisabledMcpServers(userClaudeJson, "disabledMcpServers");
    for (const name of disabledUserMcps) {
        userMcpServers.delete(name);
    }

    // === PROJECT SCOPE ===
    if (cwd) {
        if (existsSync(join(cwd, "CLAUDE.md"))) claudeMdCount++;
        if (existsSync(join(cwd, "CLAUDE.local.md"))) claudeMdCount++;
        if (existsSync(join(cwd, ".claude", "CLAUDE.md"))) claudeMdCount++;
        if (existsSync(join(cwd, ".claude", "CLAUDE.local.md"))) claudeMdCount++;

        const mcpJsonServers = getMcpServerNames(join(cwd, ".mcp.json"));

        const projectSettings = join(cwd, ".claude", "settings.json");
        for (const name of getMcpServerNames(projectSettings)) {
            projectMcpServers.add(name);
        }
        hooksCount += countHooksInFile(projectSettings);

        const localSettings = join(cwd, ".claude", "settings.local.json");
        for (const name of getMcpServerNames(localSettings)) {
            projectMcpServers.add(name);
        }
        hooksCount += countHooksInFile(localSettings);

        const disabledMcpJsonServers = getDisabledMcpServers(localSettings, "disabledMcpjsonServers");
        for (const name of disabledMcpJsonServers) {
            mcpJsonServers.delete(name);
        }

        for (const name of mcpJsonServers) {
            projectMcpServers.add(name);
        }
    }

    const mcpCount = userMcpServers.size + projectMcpServers.size;
    return { claudeMdCount, mcpCount, hooksCount };
}

// ============================================================================
// Rate Limits (native from Claude Code 2.1.80+)
// ============================================================================

export function usageFromRateLimits(rateLimits: { five_hour?: RateLimitWindow; seven_day?: RateLimitWindow }): UsageData {
    return {
        fiveHour: rateLimits.five_hour != null ? Math.round(rateLimits.five_hour.used_percentage) : null,
        sevenDay: rateLimits.seven_day != null ? Math.round(rateLimits.seven_day.used_percentage) : null,
        fiveHourResetAt: rateLimits.five_hour ? new Date(rateLimits.five_hour.resets_at * 1000) : null,
        sevenDayResetAt: rateLimits.seven_day ? new Date(rateLimits.seven_day.resets_at * 1000) : null,
    };
}

// ============================================================================
// Terminal Width
// ============================================================================
// Claude Code >= 2.1.153 sets COLUMNS/LINES in the statusline subprocess
// environment, so width detection is usually free. Older versions spawn the
// subprocess without a controlling TTY (and with a narrow ~80-col PTY on
// stdout), so as a fallback we walk up ancestor PIDs to find a shell process
// that owns the real PTY, then ask stty to open that device directly with
// `-F` (GNU) or `-f` (BSD), which uses O_NOCTTY and works even from a process
// without its own controlling terminal.

// shell -> Claude Code -> node -> ccsl is ~4 levels; 8 leaves headroom for
// multiplexers (tmux, screen) and nested shells.
const MAX_ANCESTOR_DEPTH = 8;

// Prefer the stty form that actually exists on each platform — saves a
// guaranteed-to-fail subprocess spawn on the hot path.
const STTY_FORMS: readonly string[] = process.platform === "linux"
    ? ["-F", "-f"]
    : ["-f", "-F"];

function parsePositiveInteger(value: string): number | null {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) return null;
    return parsed;
}

interface ParentInfo {
    ppid: number;
    tty: string | null;
}

function getParentInfo(pid: number): ParentInfo | null {
    try {
        const out = execFileSync("ps", ["-o", "ppid=,tty=", "-p", String(pid)], {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "ignore"],
        }).trim();
        if (!out) return null;
        const [ppidRaw, ttyRaw = ""] = out.split(/\s+/);
        const ppid = parsePositiveInteger(ppidRaw ?? "");
        if (ppid === null) return null;
        const tty = !ttyRaw || ttyRaw === "??" || ttyRaw === "?" ? null : ttyRaw;
        return { ppid, tty };
    } catch {
        return null;
    }
}

function getWidthForTTY(tty: string): number | null {
    const devicePath = `/dev/${tty}`;
    for (const flag of STTY_FORMS) {
        try {
            const out = execFileSync("stty", [flag, devicePath, "size"], {
                encoding: "utf8",
                stdio: ["pipe", "pipe", "ignore"],
            }).trim();
            const cols = parsePositiveInteger(out.split(/\s+/)[1] ?? "");
            if (cols !== null) return cols;
        } catch {
            // try next form
        }
    }
    // Last-ditch fallback for environments where neither -F nor -f exists.
    // Needs a shell because we redirect from the device.
    try {
        const out = execSync(`stty size < ${devicePath}`, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "ignore"],
            shell: "/bin/sh",
        }).trim();
        return parsePositiveInteger(out.split(/\s+/)[1] ?? "");
    } catch {
        return null;
    }
}

export function getTerminalWidth(): number | null {
    // Explicit override for environments where probing fails (IDE
    // integrations, nested shells, etc.). Set CCSL_WIDTH=200 in the
    // statusLine command to bypass detection entirely.
    const override = process.env.CCSL_WIDTH;
    if (override) {
        const parsed = parsePositiveInteger(override);
        if (parsed !== null) return parsed;
    }

    // Claude Code >= 2.1.153 sets COLUMNS to the real terminal width before
    // invoking the statusline command.
    const envCols = process.env.COLUMNS;
    if (envCols) {
        const parsed = parsePositiveInteger(envCols);
        if (parsed !== null) return parsed;
    }

    if (process.platform === "win32") return null;

    let pid = process.pid;
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
        const info = getParentInfo(pid);
        if (info === null) return null;
        pid = info.ppid;

        if (info.tty === null) continue;

        const width = getWidthForTTY(info.tty);
        if (width !== null) return width;
    }

    return null;
}

// ============================================================================
// Main
// ============================================================================

export async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf-8");
}

// Claude Code allocates a narrow PTY (~80 cols) to subprocess commands in
// recent versions; a fixed 50-char reserve leaves too little for badges.
// This default keeps maxWidth >= MIN_CONTENT_WIDTH for all terminals while
// still reserving up to MAX_RESERVED chars on wider ones.
const MIN_CONTENT_WIDTH = 85;
const MAX_RESERVED = 50;
export function defaultFlexPadding(termWidth: number): number {
    return Math.max(0, Math.min(MAX_RESERVED, termWidth - MIN_CONTENT_WIDTH));
}

export function calculateMaxWidth(
    termWidth: number,
    config: CcslConfig,
    contextPercent: number,
): number {
    const padding = config.flexPadding ?? defaultFlexPadding(termWidth);
    switch (config.flexMode ?? "full-until-compact") {
        case "full":
            return termWidth - padding;
        case "full-minus-40":
            return termWidth - 40;
        case "full-until-compact":
            return contextPercent >= (config.compactThreshold ?? 60)
                ? termWidth - Math.max(padding, 40)
                : termWidth - padding;
    }
}

export async function main() {
    const inputStr = await readStdin();
    const input: StatuslineInput = JSON.parse(inputStr);

    const projectDir = getProjectDir(input);
    const config = readStatuslineConfig();

    const usageData = input.rate_limits ? usageFromRateLimits(input.rate_limits) : null;

    const [gitInfo, transcriptData, configCounts] = await Promise.all([
        fetchGitRepoInfo(projectDir),
        parseTranscriptFull(input.transcript_path),
        Promise.resolve(countConfigs(projectDir)),
    ]);

    const prInfo = prInfoFromInput(input) ?? (gitInfo ? await fetchPrInfo() : null);

    const termWidth = getTerminalWidth() || process.stdout.columns || 75;
    const contextPercent = getPercentUsed(input);
    const maxWidth = calculateMaxWidth(termWidth, config, contextPercent);

    const data: UnifiedStatuslineData = {
        input,
        gitInfo,
        prInfo,
        transcriptData,
        configCounts,
        usageData,
    };

    const output = buildStatuslineOutput(data, maxWidth, termWidth, config);
    process.stdout.write(output);
}
