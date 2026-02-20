import { execFile, execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, createReadStream } from "node:fs";
import { promisify } from "node:util";
import process from "node:process";
import * as readline from "node:readline";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import * as https from "node:https";

import type {
    StatuslineInput,
    GitRepoInfo,
    GitFileStats,
    PrInfo,
    TranscriptData,
    AgentEntry,
    TodoItem,
    UnifiedStatuslineData,
    LearningStatus,
    ConfigCounts,
    UsageData,
    CcslConfig,
} from "./types.js";
import {
    extractWorktreeName,
    extractRepoName,
    extractRepoNameFromCommonDir,
    getProjectDir,
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

export async function fetchPrInfo(): Promise<PrInfo | null> {
    try {
        const { stdout } = await execFileP(
            "gh", ["pr", "view", "--json=number,url,title,isDraft,state,mergeStateStatus"],
        );
        const parsed = JSON.parse(stdout);
        return {
            url: parsed.url,
            number: String(parsed.number),
            title: parsed.title,
            isDraft: parsed.isDraft,
            state: parsed.state,
            mergeStateStatus: parsed.mergeStateStatus,
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

                if (!result.sessionStart && entry.timestamp) {
                    result.sessionStart = timestamp;
                }

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

function countRulesInDir(rulesDir: string): number {
    if (!existsSync(rulesDir)) return 0;
    let count = 0;
    try {
        const entries = readdirSync(rulesDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(rulesDir, entry.name);
            if (entry.isDirectory()) {
                count += countRulesInDir(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".md")) {
                count++;
            }
        }
    } catch {
        // Ignore read errors
    }
    return count;
}

export function countConfigs(cwd?: string): ConfigCounts {
    let claudeMdCount = 0;
    let rulesCount = 0;
    let hooksCount = 0;

    const homeDir = homedir();
    const claudeDir = join(homeDir, ".claude");

    const userMcpServers = new Set<string>();
    const projectMcpServers = new Set<string>();

    // === USER SCOPE ===
    if (existsSync(join(claudeDir, "CLAUDE.md"))) {
        claudeMdCount++;
    }
    rulesCount += countRulesInDir(join(claudeDir, "rules"));

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

        rulesCount += countRulesInDir(join(cwd, ".claude", "rules"));

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
    return { claudeMdCount, rulesCount, mcpCount, hooksCount };
}

// ============================================================================
// Usage API
// ============================================================================

const USAGE_CACHE_TTL_MS = 60_000;
const USAGE_CACHE_FAILURE_TTL_MS = 15_000;
const KEYCHAIN_TIMEOUT_MS = 5000;
const KEYCHAIN_BACKOFF_MS = 60_000;

interface CredentialsFile {
    claudeAiOauth?: {
        accessToken?: string;
        subscriptionType?: string;
        expiresAt?: number;
    };
}

interface UsageApiResponse {
    five_hour?: { utilization?: number; resets_at?: string };
    seven_day?: { utilization?: number; resets_at?: string };
}

interface UsageCacheFile {
    data: UsageData;
    timestamp: number;
}

function getUsageCachePath(): string {
    return join(homedir(), ".claude", "plugins", "ccsl", ".usage-cache.json");
}

function getKeychainBackoffPath(): string {
    return join(homedir(), ".claude", "plugins", "ccsl", ".keychain-backoff");
}

function readUsageCache(now: number): UsageData | null {
    try {
        const cachePath = getUsageCachePath();
        if (!existsSync(cachePath)) return null;

        const content = readFileSync(cachePath, "utf8");
        const cache: UsageCacheFile = JSON.parse(content);

        const ttl = cache.data.apiUnavailable ? USAGE_CACHE_FAILURE_TTL_MS : USAGE_CACHE_TTL_MS;
        if (now - cache.timestamp >= ttl) return null;

        const data = cache.data;
        if (data.fiveHourResetAt) {
            data.fiveHourResetAt = new Date(data.fiveHourResetAt);
        }
        if (data.sevenDayResetAt) {
            data.sevenDayResetAt = new Date(data.sevenDayResetAt);
        }
        return data;
    } catch {
        return null;
    }
}

function writeUsageCache(data: UsageData, timestamp: number): void {
    try {
        const cachePath = getUsageCachePath();
        const cacheDir = dirname(cachePath);

        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, { recursive: true });
        }

        const cache: UsageCacheFile = { data, timestamp };
        writeFileSync(cachePath, JSON.stringify(cache), "utf8");
    } catch {
        // Ignore cache write failures
    }
}

function isKeychainBackoff(now: number): boolean {
    try {
        const backoffPath = getKeychainBackoffPath();
        if (!existsSync(backoffPath)) return false;
        const timestamp = parseInt(readFileSync(backoffPath, "utf8"), 10);
        return now - timestamp < KEYCHAIN_BACKOFF_MS;
    } catch {
        return false;
    }
}

function recordKeychainFailure(now: number): void {
    try {
        const backoffPath = getKeychainBackoffPath();
        const dir = dirname(backoffPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(backoffPath, String(now), "utf8");
    } catch {
        // Ignore write failures
    }
}

function readKeychainCredentials(now: number): { accessToken: string; subscriptionType: string } | null {
    if (platform() !== "darwin") return null;
    if (isKeychainBackoff(now)) return null;

    try {
        const keychainData = execFileSync(
            "/usr/bin/security",
            ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
            { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: KEYCHAIN_TIMEOUT_MS }
        ).trim();

        if (!keychainData) return null;

        const data: CredentialsFile = JSON.parse(keychainData);
        return parseCredentialsData(data, now);
    } catch {
        recordKeychainFailure(now);
        return null;
    }
}

function readFileCredentials(now: number): { accessToken: string; subscriptionType: string } | null {
    const credentialsPath = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(credentialsPath)) return null;

    try {
        const content = readFileSync(credentialsPath, "utf8");
        const data: CredentialsFile = JSON.parse(content);
        return parseCredentialsData(data, now);
    } catch {
        return null;
    }
}

function parseCredentialsData(data: CredentialsFile, now: number): { accessToken: string; subscriptionType: string } | null {
    const accessToken = data.claudeAiOauth?.accessToken;
    const subscriptionType = data.claudeAiOauth?.subscriptionType ?? "";

    if (!accessToken) return null;

    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt != null && expiresAt <= now) return null;

    return { accessToken, subscriptionType };
}

function getPlanName(subscriptionType: string): string | null {
    const lower = subscriptionType.toLowerCase();
    if (lower.includes("max")) return "Max";
    if (lower.includes("pro")) return "Pro";
    if (lower.includes("team")) return "Team";
    if (!subscriptionType || lower.includes("api")) return null;
    return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

function parseUtilization(value: number | undefined): number | null {
    if (value == null) return null;
    if (!Number.isFinite(value)) return null;
    return Math.round(Math.max(0, Math.min(100, value)));
}

function parseDate(dateStr: string | undefined): Date | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date;
}

function fetchUsageApi(accessToken: string): Promise<UsageApiResponse | null> {
    return new Promise((resolve) => {
        const options = {
            hostname: "api.anthropic.com",
            path: "/api/oauth/usage",
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "anthropic-beta": "oauth-2025-04-20",
                "User-Agent": "ccsl/0.1.0",
            },
            timeout: 5000,
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
            res.on("end", () => {
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(null);
                }
            });
        });

        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.end();
    });
}

export async function getUsageData(): Promise<UsageData | null> {
    const now = Date.now();

    const cached = readUsageCache(now);
    if (cached) return cached;

    try {
        let credentials = readKeychainCredentials(now);
        if (!credentials) {
            credentials = readFileCredentials(now);
        }
        if (!credentials) return null;

        const { accessToken, subscriptionType } = credentials;
        const planName = getPlanName(subscriptionType);
        if (!planName) return null;

        const apiResponse = await fetchUsageApi(accessToken);
        if (!apiResponse) {
            const failureResult: UsageData = {
                planName,
                fiveHour: null,
                sevenDay: null,
                fiveHourResetAt: null,
                sevenDayResetAt: null,
                apiUnavailable: true,
            };
            writeUsageCache(failureResult, now);
            return failureResult;
        }

        const result: UsageData = {
            planName,
            fiveHour: parseUtilization(apiResponse.five_hour?.utilization),
            sevenDay: parseUtilization(apiResponse.seven_day?.utilization),
            fiveHourResetAt: parseDate(apiResponse.five_hour?.resets_at),
            sevenDayResetAt: parseDate(apiResponse.seven_day?.resets_at),
        };

        writeUsageCache(result, now);
        return result;
    } catch {
        return null;
    }
}

// ============================================================================
// Learning Loop Status
// ============================================================================

export function getLearningStatus(sessionStart: Date | undefined): LearningStatus {
    const claudeDir = join(homedir(), ".claude");

    let recalledThisSession = false;
    try {
        const recallPath = join(claudeDir, ".last-recall");
        if (existsSync(recallPath)) {
            const ts = parseInt(readFileSync(recallPath, "utf8").trim(), 10);
            if (sessionStart) {
                recalledThisSession = ts * 1000 >= sessionStart.getTime();
            } else {
                recalledThisSession = Date.now() - ts * 1000 < 5 * 60 * 1000;
            }
        }
    } catch { /* ignore */ }

    const learningPending = existsSync(join(claudeDir, ".learning-pending"));

    let autoLearn = false;
    try {
        const mode = JSON.parse(readFileSync(join(claudeDir, "learning-mode.json"), "utf8"));
        autoLearn = mode.auto === true;
    } catch { /* ignore */ }

    let lastLearnedDate: string | null = null;
    try {
        const log = readFileSync(join(claudeDir, "learning-log.md"), "utf8");
        const match = log.match(/^## (\d{4})-(\d{2})-(\d{2})/m);
        if (match) {
            const logDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today.getTime() - 86400000);
            if (logDate >= today) lastLearnedDate = "today";
            else if (logDate >= yesterday) lastLearnedDate = "yesterday";
            else {
                const diffDays = Math.floor((now.getTime() - logDate.getTime()) / 86400000);
                lastLearnedDate = `${diffDays}d ago`;
            }
        }
    } catch { /* ignore */ }

    return { recalledThisSession, learningPending, autoLearn, lastLearnedDate };
}

// ============================================================================
// Terminal Width
// ============================================================================

export function getTerminalWidth(): number | null {
    try {
        const tty = execSync("ps -o tty= -p $(ps -o ppid= -p $$)", {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "ignore"],
            shell: "/bin/sh",
        }).trim();

        if (tty && tty !== "??" && tty !== "?") {
            const width = execSync(
                `stty size < /dev/${tty} | awk '{print $2}'`,
                {
                    encoding: "utf8",
                    stdio: ["pipe", "pipe", "ignore"],
                    shell: "/bin/sh",
                },
            ).trim();

            const parsed = parseInt(width, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
    } catch {
        // Command failed, width detection not available
    }

    try {
        const width = execSync("tput cols 2>/dev/null", {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "ignore"],
        }).trim();

        const parsed = parseInt(width, 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    } catch {
        // tput also failed
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

export async function main() {
    const inputStr = await readStdin();
    const input: StatuslineInput = JSON.parse(inputStr);

    const projectDir = getProjectDir(input);
    const config = readStatuslineConfig();

    const promises: [
        Promise<GitRepoInfo | null>,
        Promise<TranscriptData | null>,
        Promise<ConfigCounts>,
        Promise<UsageData | null>,
    ] = [
        fetchGitRepoInfo(projectDir),
        parseTranscriptFull(input.transcript_path),
        Promise.resolve(countConfigs(projectDir)),
        getUsageData(),
    ];

    const [gitInfo, transcriptData, configCounts, usageData] = await Promise.all(promises);

    const prInfo = gitInfo ? await fetchPrInfo() : null;

    const learningStatus = config.features.learning
        ? getLearningStatus(transcriptData?.sessionStart)
        : null;

    const maybeTerminalWidth = getTerminalWidth();
    const termWidth = maybeTerminalWidth || process.stdout.columns || parseInt(process.env.COLUMNS || "0") || 75;
    const maxWidth = Math.min(termWidth - 4, 140);

    const data: UnifiedStatuslineData = {
        input,
        gitInfo,
        prInfo,
        transcriptData,
        configCounts,
        usageData,
        learningStatus,
    };

    const output = buildStatuslineOutput(data, maxWidth, termWidth, config);
    process.stdout.write(output);
}
