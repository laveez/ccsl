import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type {
    StatuslineInput,
    ConfigCounts,
    GitRepoInfo,
    PrInfo,
    ToolAggregation,
    AgentEntry,
    TodoItem,
    UsageData,
    LearningStatus,
    UnifiedStatuslineData,
    BadgeColor,
    BadgeGroup,
    RowConfig,
    CcslConfig,
} from "./types.js";
import { BADGE, BADGE_GROUPS, DEFAULT_ROWS, PRESET_DENSE, PRESET_SEMANTIC, PRESET_ADAPTIVE } from "./types.js";
import {
    bgRgb,
    fgWhite,
    reset,
    CLEAR_LINE_WITH_DEFAULT_BG,
    RESET_ALL,
    RESET_BG,
    RESET_FG,
    COLORS,
    stripEmojis,
    colorSegment,
    joinSegmentsWithWrap,
    badge,
    badgeRich,
    badgeGradient,
    gradientColor,
    formatDuration,
    formatTimeUntil,
    formatTokenCount,
    formatFileStats,
    makeRelativePath,
    getShortMcpName,
    getToolDisplayName,
    extractTicketMarker,
    getPrStatusSuffix,
    getModelName,
    getCost,
    getDuration,
    getContextWindowSize,
    getCurrentUsage,
    calculateCurrentTokens,
    calculatePercentUsed,
} from "./utils.js";

export function renderContextBar(percent: number, width: number = 10): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;

    let filledColor: string;
    if (percent >= 85) {
        filledColor = COLORS.barRed;
    } else if (percent >= 70) {
        filledColor = COLORS.barYellow;
    } else {
        filledColor = COLORS.barGreen;
    }

    return `${filledColor}${"█".repeat(filled)}${COLORS.barEmpty}${"░".repeat(empty)}${reset()}`;
}

function renderBarWithText(percent: number, text: string): string {
    const plainLen = text.length;
    const filledChars = Math.round((percent / 100) * plainLen);

    let filledBg: [number, number, number];
    if (percent >= 85) filledBg = [140, 60, 60];
    else if (percent >= 70) filledBg = [140, 120, 40];
    else filledBg = [50, 110, 50];

    const emptyBg: [number, number, number] = [45, 48, 55];

    const filledPart = text.slice(0, filledChars);
    const emptyPart = text.slice(filledChars);

    let result = "";
    if (filledPart) result += `${bgRgb(...filledBg)}${fgWhite()}${filledPart}`;
    if (emptyPart) result += `${bgRgb(...emptyBg)}${fgWhite()}${emptyPart}`;
    return result;
}

export function renderUsageBar(percent: number | null, width: number = 10): string {
    if (percent === null) return `${COLORS.barEmpty}${"░".repeat(width)}${reset()}`;

    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;

    let filledColor: string;
    if (percent >= 90) {
        filledColor = COLORS.barRed;
    } else if (percent >= 70) {
        filledColor = COLORS.barYellow;
    } else {
        filledColor = COLORS.barGreen;
    }

    return `${filledColor}${"█".repeat(filled)}${COLORS.barEmpty}${"░".repeat(empty)}${reset()}`;
}

// ============================================================================
// Badge Builders
// ============================================================================

function buildIdentityBadges(input: StatuslineInput, usageData: UsageData | null, duration: number): string[] {
    const badges: string[] = [];
    const modelName = getModelName(input);
    const modelPlan = usageData?.planName ? `${modelName} | ${usageData.planName}` : modelName;
    badges.push(badge("blue", modelPlan));
    const durationMin = duration / 60000;
    const durBg = gradientColor([
        [0, BADGE.green], [60, BADGE.gold], [180, BADGE.purple],
    ], durationMin);
    badges.push(badgeGradient(durBg, `⏲ ${formatDuration(duration)}`));
    const cost = getCost(input);
    const costStr = cost >= 10 ? `$${Math.floor(cost)}` : `$${cost.toFixed(2)}`;
    const costBg = gradientColor([
        [0, BADGE.green], [10, BADGE.gold], [50, BADGE.orange], [100, BADGE.rose],
    ], cost);
    badges.push(badgeGradient(costBg, `💸 ${costStr}`));
    return badges;
}

function buildContextBadges(input: StatuslineInput): string[] {
    const badges: string[] = [];
    const contextSize = getContextWindowSize(input);
    const usage = getCurrentUsage(input);
    const currentTokens = calculateCurrentTokens(usage);
    const percentUsed = calculatePercentUsed(currentTokens, contextSize);
    const tokensK = Math.floor(currentTokens / 1000);
    const barText = ` ${tokensK}k=${percentUsed}% `;
    const inlineBar = renderBarWithText(percentUsed, barText);
    badges.push(badgeRich("cyan", `${fgWhite()}🧠 ${inlineBar}`));
    if (usage) {
        const r = formatTokenCount(usage.cache_read_input_tokens);
        const w = formatTokenCount(usage.cache_creation_input_tokens);
        const u = formatTokenCount(usage.input_tokens);
        badges.push(badge("cyan", `🔥 ${r}r·${w}w·${u}u`));
    }
    return badges;
}

function buildUsageBadges(usageData: UsageData | null): string[] {
    if (!usageData || usageData.fiveHour === null) return [];
    const resetTime = formatTimeUntil(usageData.fiveHourResetAt);
    const resetStr = resetTime ? ` (${resetTime} / 5h)` : "";
    const barText = ` ${usageData.fiveHour}%${resetStr} `;
    const inlineBar = renderBarWithText(usageData.fiveHour, barText);
    return [badgeRich("orange", `${fgWhite()}⚡${inlineBar}`)];
}

function buildGitBadges(gitInfo: GitRepoInfo | null, input: StatuslineInput): string[] {
    if (!gitInfo?.repo) return [];
    const badges: string[] = [];
    badges.push(badge("green", gitInfo.repo));
    if (gitInfo.worktree) {
        const wt = gitInfo.worktree.length > 25 ? gitInfo.worktree.slice(0, 24) + "…" : gitInfo.worktree;
        badges.push(badge("cyan", `🌳 ${wt}`));
    } else if (gitInfo.branch) {
        const isDefault = /^(main|master)$/.test(gitInfo.branch);
        const br = gitInfo.branch.length > 25 ? gitInfo.branch.slice(0, 24) + "…" : gitInfo.branch;
        badges.push(badge(isDefault ? "purple" : "green", `🌿 ${br}`));
    }
    const statsStr = formatFileStats(gitInfo.fileStats);
    if (statsStr) badges.push(badge("green", statsStr));
    const aheadBehind: string[] = [];
    if (gitInfo.ahead && gitInfo.ahead > 0) aheadBehind.push(`↑${gitInfo.ahead}`);
    if (gitInfo.behind && gitInfo.behind > 0) aheadBehind.push(`↓${gitInfo.behind}`);
    if (aheadBehind.length > 0) badges.push(badge("green", aheadBehind.join("")));
    const linesAdded = input.cost.total_lines_added;
    const linesRemoved = input.cost.total_lines_removed;
    if (linesAdded > 0 || linesRemoved > 0) {
        const greenFg = "\x1b[38;2;140;220;140m";
        const redFg = "\x1b[38;2;220;130;130m";
        badges.push(badgeRich("olive", `📊 ${greenFg}+${linesAdded}${redFg}-${linesRemoved}`));
    }
    return badges;
}

function buildConfigBadges(configCounts: ConfigCounts | null): string[] {
    if (!configCounts) return [];
    const parts: string[] = [];
    if (configCounts.claudeMdCount > 0) parts.push(`${configCounts.claudeMdCount} CLAUDE.md`);
    if (configCounts.mcpCount > 0) parts.push(`${configCounts.mcpCount} MCPs`);
    if (configCounts.hooksCount > 0) parts.push(`${configCounts.hooksCount} hooks`);
    if (parts.length === 0) return [];
    return [badge("purple", `📋 ${parts.join(" | ")}`)];
}

function buildPrBadges(prInfo: PrInfo | null): string[] {
    if (!prInfo) return [];
    const badges: string[] = [];
    if (prInfo.title) {
        const ticket = extractTicketMarker(prInfo.title);
        if (ticket) badges.push(badge("purple", `🎫 ${ticket}`));
    }
    const statusSuffix = getPrStatusSuffix(prInfo);
    const prText = `🔗 PR#${prInfo.number}${statusSuffix}`;
    const prBadge = badge("blue", prText);
    badges.push(`\x1b]8;;${prInfo.url}\x07${prBadge}\x1b]8;;\x07`);
    return badges;
}

function buildRemoteControlBadge(active: boolean): string[] {
    return [badge(active ? "cyan" : "steel", `📱 ${active ? "RC" : "local"}`)];
}

function buildLearningBadges(learningStatus: LearningStatus | null): string[] {
    if (!learningStatus) return [];
    const badges: string[] = [];

    if (learningStatus.recalledThisSession) {
        badges.push(badge("green", "🧩 ✓"));
    } else {
        badges.push(badge("steel", "🧩 ✗"));
    }

    const obsCount = learningStatus.instinctStatus?.unprocessedObservations ?? 0;
    const obsSuffix = obsCount > 0 ? ` ${obsCount}` : " ✓";

    if (learningStatus.learningPending) {
        badges.push(badge("rose", `📚 ⚠${obsSuffix}`));
    } else if (learningStatus.lastLearnedDate) {
        badges.push(badge(obsCount > 0 ? "gold" : "green", `📚 ${learningStatus.lastLearnedDate}${obsSuffix}`));
    } else {
        badges.push(badge("steel", `📚${obsSuffix}`));
    }

    const inst = learningStatus.instinctStatus;
    if (inst) {
        let text = `🧬 ${inst.activeCount}`;
        let color: BadgeColor = "steel";
        if (inst.promotableCount > 0) {
            text += ` ▲${inst.promotableCount}`;
            color = "gold";
        }
        if (inst.correctionsThisSession > 0) {
            text += " !";
            color = "rose";
        }
        badges.push(badge(color, text));
    }

    return badges;
}

function buildTranscriptBadge(transcriptPath: string): string {
    const name = transcriptPath.split("/").pop() || transcriptPath;
    const shortName = name.length > 20 ? name.slice(0, 8) + "…jsonl" : name;
    const inner = badge("steel", `📝 ${shortName}`);
    return `\x1b]8;;file://${transcriptPath}\x07${inner}\x1b]8;;\x07`;
}

const TOOL_COLORS: Record<string, BadgeColor> = {
    Read: "green", Write: "green", Edit: "green", NotebookEdit: "green",
    Grep: "purple", Glob: "purple",
    Bash: "orange",
    Task: "blue", Skill: "blue", AskUserQuestion: "blue",
    TaskCreate: "gold", TaskUpdate: "gold", TaskList: "gold", TaskGet: "gold", TodoWrite: "gold",
    WebFetch: "cyan", WebSearch: "cyan", ToolSearch: "cyan",
};

function buildToolBadges(tools: ToolAggregation, cwd: string): string[] {
    const badges: string[] = [];
    for (const tool of tools.running) {
        const name = getToolDisplayName(tool.name);
        const target = tool.target ? `: ${makeRelativePath(tool.target, cwd)}` : "";
        badges.push(badge("cyan", `◐ ${name}${target}`));
    }
    const mcpGroups = new Map<string, number>();
    const builtinCounts: [string, number][] = [];
    for (const [name, count] of tools.completed) {
        if (name.startsWith("mcp__")) {
            const short = getShortMcpName(name);
            mcpGroups.set(short, (mcpGroups.get(short) || 0) + count);
        } else {
            builtinCounts.push([name, count]);
        }
    }
    for (const [name, count] of builtinCounts) {
        const color = TOOL_COLORS[name] ?? "charcoal";
        badges.push(badge(color, `${name}×${count}`));
    }
    for (const [name, count] of mcpGroups) {
        badges.push(badge("steel", `🔌${name}×${count}`));
    }
    return badges;
}

function buildAgentBadges(agents: AgentEntry[], _cwd: string): string[] {
    if (agents.length === 0) return [];
    const running = agents.filter(a => a.status === "running");
    const completed = agents.filter(a => a.status === "completed").slice(-2);
    const badges: string[] = [];
    const shortType = (t: string) => t.split("-")[0];
    const shortDesc = (d: string, max: number) => d.length > max ? d.slice(0, max) + "…" : d;
    for (const agent of running) {
        const dur = formatDuration(Date.now() - agent.startTime.getTime());
        const desc = agent.description ? ` ${shortDesc(agent.description, 25)}` : "";
        badges.push(badge("cyan", `◐ ${shortType(agent.type)}${desc} (${dur})`));
    }
    for (const agent of completed) {
        const dur = agent.endTime
            ? formatDuration(agent.endTime.getTime() - agent.startTime.getTime())
            : "";
        const desc = agent.description ? ` ${shortDesc(agent.description, 25)}` : "";
        const durStr = dur ? ` ${dur}` : "";
        badges.push(badge("steel", `✓ ${shortType(agent.type)}${desc}${durStr}`));
    }
    return badges;
}

function buildTodoBadges(todos: TodoItem[]): string[] {
    if (todos.length === 0) return [];
    const completed = todos.filter(t => t.status === "completed").length;
    const inProgress = todos.find(t => t.status === "in_progress");
    const total = todos.length;
    if (inProgress) {
        return [badge("cyan", `▸ ${inProgress.subject} (${completed}/${total})`)];
    }
    const pending = todos.find(t => t.status === "pending");
    if (pending) {
        return [badge("charcoal", `▹ ${pending.subject} (${completed}/${total})`)];
    }
    return [badge("green", `✓ All done (${completed}/${total})`)];
}

// ============================================================================
// Row-based Layout Engine
// ============================================================================

type BadgeGroupBuilder = (data: UnifiedStatuslineData, config: CcslConfig) => string[];

const badgeGroupBuilders: Record<BadgeGroup, BadgeGroupBuilder> = {
    identity: (data) => buildIdentityBadges(data.input, data.usageData, getDuration(data.input)),
    context: (data) => buildContextBadges(data.input),
    usage: (data, config) => config.features.usage ? buildUsageBadges(data.usageData) : [],
    git: (data) => buildGitBadges(data.gitInfo, data.input),
    config: (data) => buildConfigBadges(data.configCounts),
    pr: (data) => buildPrBadges(data.prInfo),
    learning: (data, config) => config.features.learning ? buildLearningBadges(data.learningStatus) : [],
    remoteControl: (data, config) => config.features.remoteControl ? buildRemoteControlBadge(data.transcriptData?.remoteControlActive === true) : [],
    transcript: (data) => [buildTranscriptBadge(data.input.transcript_path)],
    tools: (data) => data.transcriptData?.tools ? buildToolBadges(data.transcriptData.tools, data.input.workspace.current_dir) : [],
    agents: (data) => data.transcriptData?.agents?.length ? buildAgentBadges(data.transcriptData.agents, data.input.workspace.current_dir) : [],
    todos: (data) => data.transcriptData?.todos?.length ? buildTodoBadges(data.transcriptData.todos) : [],
};

function buildRowLayout(data: UnifiedStatuslineData, maxWidth: number, config: CcslConfig): string[] {
    const rows = config.rows ?? DEFAULT_ROWS;
    const lines: string[] = [];
    for (const row of rows) {
        if (row === "---") {
            const ruleWidth = Math.min(maxWidth || 60, 60);
            lines.push(`\x1b[38;2;60;60;60m${"─".repeat(ruleWidth)}${reset()}`);
            continue;
        }

        const badges: string[] = [];
        for (const group of row) {
            const builder = badgeGroupBuilders[group];
            if (builder) badges.push(...builder(data, config));
        }
        if (badges.length > 0) {
            lines.push(joinSegmentsWithWrap(badges, maxWidth));
        }
    }

    return lines;
}

// ============================================================================
// Config & Output
// ============================================================================

const VALID_BADGE_GROUPS = new Set<string>(BADGE_GROUPS);

function parseRows(rawRows: unknown): RowConfig | undefined {
    if (!Array.isArray(rawRows)) return undefined;
    const result: RowConfig = [];
    for (const item of rawRows) {
        if (item === "---") {
            result.push("---");
        } else if (Array.isArray(item)) {
            const groups = item.filter(
                (g: unknown): g is BadgeGroup => typeof g === "string" && VALID_BADGE_GROUPS.has(g),
            );
            if (groups.length > 0) result.push(groups);
        }
    }
    return result.length > 0 ? result : undefined;
}

function layoutToRows(layout: string): RowConfig {
    switch (layout) {
        case "semantic": return PRESET_SEMANTIC;
        case "adaptive": return PRESET_ADAPTIVE;
        case "dense":
        default: return PRESET_DENSE;
    }
}

export function readStatuslineConfig(): CcslConfig {
    try {
        const configPath = join(homedir(), ".claude", "statusline-config.json");
        if (!existsSync(configPath)) {
            return { rows: DEFAULT_ROWS, features: { usage: false, learning: false, remoteControl: false } };
        }
        const content = readFileSync(configPath, "utf8");
        const config = JSON.parse(content);
        const layout = config.layout;
        const validLayout = (layout === "semantic" || layout === "dense" || layout === "adaptive")
            ? layout
            : "dense";
        const features = config.features ?? {};
        const flexMode = config.flexMode;
        const validFlexMode = (flexMode === "full" || flexMode === "full-minus-40" || flexMode === "full-until-compact")
            ? flexMode
            : undefined;
        const rows = parseRows(config.rows) ?? layoutToRows(validLayout);
        return {
            layout: validLayout,
            rows,
            flexMode: validFlexMode,
            compactThreshold: typeof config.compactThreshold === "number" ? config.compactThreshold : undefined,
            flexPadding: typeof config.flexPadding === "number" ? config.flexPadding : undefined,
            features: {
                usage: features.usage === true,
                learning: features.learning === true,
                remoteControl: features.remoteControl === true,
            },
        };
    } catch { /* ignore */ }
    return { rows: DEFAULT_ROWS, features: { usage: false, learning: false, remoteControl: false } };
}

export function buildStatuslineOutput(
    data: UnifiedStatuslineData,
    maxWidth: number = 0,
    termWidth: number = 0,
    config: CcslConfig = readStatuslineConfig(),
): string {
    let lines = buildRowLayout(data, maxWidth, config);

    if (termWidth > 0 && termWidth < 80) {
        lines = lines.map(line => stripEmojis(line));
    }

    const ERASE_TO_EOL = "\x1b[K";
    const RESET_PREFIX = "\x1b[0m";
    let output = lines
        .map(line => {
            let hardened = line + reset() + ERASE_TO_EOL;
            hardened = hardened.replace(/ /g, "\u00A0");
            hardened = RESET_PREFIX + hardened;
            return hardened;
        })
        .join("\n");
    output = CLEAR_LINE_WITH_DEFAULT_BG + output + RESET_ALL + RESET_BG + RESET_FG;
    if (!output.includes("\n")) {
        output += "\n";
    }
    return output;
}
