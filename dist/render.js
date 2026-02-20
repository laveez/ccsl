import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BADGE } from "./types.js";
import { bgRgb, fgWhite, reset, CLEAR_LINE_WITH_DEFAULT_BG, RESET_ALL, RESET_BG, RESET_FG, COLORS, stripEmojis, joinSegmentsWithWrap, badge, badgeRich, badgeGradient, gradientColor, formatDuration, formatTimeUntil, formatTokenCount, formatFileStats, makeRelativePath, getShortMcpName, getToolDisplayName, extractTicketMarker, getPrStatusSuffix, getModelName, getCost, getDuration, getContextWindowSize, getCurrentUsage, calculateCurrentTokens, calculatePercentUsed, } from "./utils.js";
export function renderContextBar(percent, width = 10) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    let filledColor;
    if (percent >= 85) {
        filledColor = COLORS.barRed;
    }
    else if (percent >= 70) {
        filledColor = COLORS.barYellow;
    }
    else {
        filledColor = COLORS.barGreen;
    }
    return `${filledColor}${"█".repeat(filled)}${COLORS.barEmpty}${"░".repeat(empty)}${reset()}`;
}
function renderBarWithText(percent, text) {
    const plainLen = text.length;
    const filledChars = Math.round((percent / 100) * plainLen);
    let filledBg;
    if (percent >= 85)
        filledBg = [140, 60, 60];
    else if (percent >= 70)
        filledBg = [140, 120, 40];
    else
        filledBg = [50, 110, 50];
    const emptyBg = [45, 48, 55];
    const filledPart = text.slice(0, filledChars);
    const emptyPart = text.slice(filledChars);
    let result = "";
    if (filledPart)
        result += `${bgRgb(...filledBg)}${fgWhite()}${filledPart}`;
    if (emptyPart)
        result += `${bgRgb(...emptyBg)}${fgWhite()}${emptyPart}`;
    return result;
}
export function renderUsageBar(percent, width = 10) {
    if (percent === null)
        return `${COLORS.barEmpty}${"░".repeat(width)}${reset()}`;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    let filledColor;
    if (percent >= 90) {
        filledColor = COLORS.barRed;
    }
    else if (percent >= 70) {
        filledColor = COLORS.barYellow;
    }
    else {
        filledColor = COLORS.barGreen;
    }
    return `${filledColor}${"█".repeat(filled)}${COLORS.barEmpty}${"░".repeat(empty)}${reset()}`;
}
// ============================================================================
// Badge Builders
// ============================================================================
function buildIdentityBadges(input, usageData, duration) {
    const badges = [];
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
function buildContextBadges(input) {
    const badges = [];
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
function buildUsageBadges(usageData) {
    if (!usageData || usageData.fiveHour === null)
        return [];
    const resetTime = formatTimeUntil(usageData.fiveHourResetAt);
    const resetStr = resetTime ? ` (${resetTime} / 5h)` : "";
    const barText = ` ${usageData.fiveHour}%${resetStr} `;
    const inlineBar = renderBarWithText(usageData.fiveHour, barText);
    return [badgeRich("orange", `${fgWhite()}⚡${inlineBar}`)];
}
function buildGitBadges(gitInfo, input) {
    if (!gitInfo?.repo)
        return [];
    const badges = [];
    badges.push(badge("green", gitInfo.repo));
    if (gitInfo.worktree) {
        const wt = gitInfo.worktree.length > 25 ? gitInfo.worktree.slice(0, 24) + "…" : gitInfo.worktree;
        badges.push(badge("cyan", `🌳 ${wt}`));
    }
    else if (gitInfo.branch) {
        const isDefault = /^(main|master)$/.test(gitInfo.branch);
        const br = gitInfo.branch.length > 25 ? gitInfo.branch.slice(0, 24) + "…" : gitInfo.branch;
        badges.push(badge(isDefault ? "purple" : "green", `🌿 ${br}`));
    }
    const statsStr = formatFileStats(gitInfo.fileStats);
    if (statsStr)
        badges.push(badge("green", statsStr));
    const aheadBehind = [];
    if (gitInfo.ahead && gitInfo.ahead > 0)
        aheadBehind.push(`↑${gitInfo.ahead}`);
    if (gitInfo.behind && gitInfo.behind > 0)
        aheadBehind.push(`↓${gitInfo.behind}`);
    if (aheadBehind.length > 0)
        badges.push(badge("green", aheadBehind.join("")));
    const linesAdded = input.cost.total_lines_added;
    const linesRemoved = input.cost.total_lines_removed;
    if (linesAdded > 0 || linesRemoved > 0) {
        const greenFg = "\x1b[38;2;140;220;140m";
        const redFg = "\x1b[38;2;220;130;130m";
        badges.push(badgeRich("olive", `📊 ${greenFg}+${linesAdded}${redFg}-${linesRemoved}`));
    }
    return badges;
}
function buildConfigBadges(configCounts) {
    if (!configCounts)
        return [];
    const parts = [];
    if (configCounts.claudeMdCount > 0)
        parts.push(`${configCounts.claudeMdCount} CLAUDE.md`);
    if (configCounts.mcpCount > 0)
        parts.push(`${configCounts.mcpCount} MCPs`);
    if (configCounts.hooksCount > 0)
        parts.push(`${configCounts.hooksCount} hooks`);
    if (parts.length === 0)
        return [];
    return [badge("purple", `📋 ${parts.join(" | ")}`)];
}
function buildPrBadges(prInfo) {
    if (!prInfo)
        return [];
    const badges = [];
    if (prInfo.title) {
        const ticket = extractTicketMarker(prInfo.title);
        if (ticket)
            badges.push(badge("purple", `🎫 ${ticket}`));
    }
    const statusSuffix = getPrStatusSuffix(prInfo);
    const prText = `🔗 PR#${prInfo.number}${statusSuffix}`;
    const prBadge = badge("blue", prText);
    badges.push(`\x1b]8;;${prInfo.url}\x07${prBadge}\x1b]8;;\x07`);
    return badges;
}
function buildCctgBadge() {
    const cctgConfig = join(homedir(), ".cctg.json");
    if (!existsSync(cctgConfig))
        return [];
    const active = existsSync(join(homedir(), ".cctg-active"));
    return [badge(active ? "orange" : "steel", `📱 ${active ? "ON" : "off"}`)];
}
function buildLearningBadges(learningStatus) {
    if (!learningStatus)
        return [];
    const badges = [];
    if (learningStatus.recalledThisSession) {
        badges.push(badge("green", "🧩 ✓"));
    }
    else {
        badges.push(badge("steel", "🧩 ✗"));
    }
    if (learningStatus.learningPending) {
        badges.push(badge("rose", "📚 ⚠"));
    }
    else if (learningStatus.lastLearnedDate) {
        badges.push(badge("gold", `📚 ${learningStatus.lastLearnedDate}`));
    }
    else {
        badges.push(badge("steel", "📚"));
    }
    return badges;
}
function buildTranscriptBadge(transcriptPath) {
    const name = transcriptPath.split("/").pop() || transcriptPath;
    const shortName = name.length > 20 ? name.slice(0, 8) + "…jsonl" : name;
    const inner = badge("steel", `📝 ${shortName}`);
    return `\x1b]8;;file://${transcriptPath}\x07${inner}\x1b]8;;\x07`;
}
const TOOL_COLORS = {
    Read: "green", Write: "green", Edit: "green", NotebookEdit: "green",
    Grep: "purple", Glob: "purple",
    Bash: "orange",
    Task: "blue", Skill: "blue", AskUserQuestion: "blue",
    TaskCreate: "gold", TaskUpdate: "gold", TaskList: "gold", TaskGet: "gold", TodoWrite: "gold",
    WebFetch: "cyan", WebSearch: "cyan", ToolSearch: "cyan",
};
function buildToolBadges(tools, cwd) {
    const badges = [];
    for (const tool of tools.running) {
        const name = getToolDisplayName(tool.name);
        const target = tool.target ? `: ${makeRelativePath(tool.target, cwd)}` : "";
        badges.push(badge("cyan", `◐ ${name}${target}`));
    }
    const mcpGroups = new Map();
    const builtinCounts = [];
    for (const [name, count] of tools.completed) {
        if (name.startsWith("mcp__")) {
            const short = getShortMcpName(name);
            mcpGroups.set(short, (mcpGroups.get(short) || 0) + count);
        }
        else {
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
function buildAgentBadges(agents, _cwd) {
    if (agents.length === 0)
        return [];
    const running = agents.filter(a => a.status === "running");
    const completed = agents.filter(a => a.status === "completed").slice(-2);
    const badges = [];
    const shortType = (t) => t.split("-")[0];
    const shortDesc = (d, max) => d.length > max ? d.slice(0, max) + "…" : d;
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
function buildTodoBadges(todos) {
    if (todos.length === 0)
        return [];
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
// Layouts
// ============================================================================
function buildDenseLayout(data, maxWidth, config) {
    const { input, gitInfo, prInfo, transcriptData, configCounts, usageData, learningStatus } = data;
    const duration = getDuration(input);
    const lines = [];
    // Row 1: identity + learning + cctg
    const row1 = [
        ...buildIdentityBadges(input, usageData, duration),
        ...(config.features.learning ? buildLearningBadges(learningStatus) : []),
        ...(config.features.cctg ? buildCctgBadge() : []),
    ];
    lines.push(joinSegmentsWithWrap(row1, maxWidth));
    // Row 2: context + usage + config
    const row2 = [
        ...buildContextBadges(input),
        ...(config.features.usage ? buildUsageBadges(usageData) : []),
        ...buildConfigBadges(configCounts),
    ];
    lines.push(joinSegmentsWithWrap(row2, maxWidth));
    // Row 3: git + PR
    const row3git = [
        ...buildGitBadges(gitInfo, input),
        ...buildPrBadges(prInfo),
    ];
    if (row3git.length > 0)
        lines.push(joinSegmentsWithWrap(row3git, maxWidth));
    // Separator between header and detail rows
    const ruleWidth = Math.min(maxWidth || 60, 60);
    lines.push(`\x1b[38;2;60;60;60m${"─".repeat(ruleWidth)}${reset()}`);
    // Row 4: transcript + tools
    const row4 = [buildTranscriptBadge(input.transcript_path)];
    if (transcriptData?.tools) {
        row4.push(...buildToolBadges(transcriptData.tools, input.workspace.current_dir));
    }
    lines.push(joinSegmentsWithWrap(row4, maxWidth));
    // Row 5: agents
    if (transcriptData?.agents && transcriptData.agents.length > 0) {
        const agentBadges = buildAgentBadges(transcriptData.agents, input.workspace.current_dir);
        if (agentBadges.length > 0)
            lines.push(joinSegmentsWithWrap(agentBadges, maxWidth));
    }
    // Row 6: todos
    if (transcriptData?.todos && transcriptData.todos.length > 0) {
        const todoBadges = buildTodoBadges(transcriptData.todos);
        if (todoBadges.length > 0)
            lines.push(joinSegmentsWithWrap(todoBadges, maxWidth));
    }
    return lines;
}
function buildSemanticLayout(data, maxWidth, config) {
    const { input, gitInfo, prInfo, transcriptData, configCounts, usageData, learningStatus } = data;
    const duration = getDuration(input);
    const lines = [];
    // L1: Identity
    lines.push(joinSegmentsWithWrap(buildIdentityBadges(input, usageData, duration), maxWidth));
    // L2: Context + usage
    const contextRow = [
        ...buildContextBadges(input),
        ...(config.features.usage ? buildUsageBadges(usageData) : []),
    ];
    lines.push(joinSegmentsWithWrap(contextRow, maxWidth));
    // L3: Git
    const gitBadges = buildGitBadges(gitInfo, input);
    if (gitBadges.length > 0)
        lines.push(joinSegmentsWithWrap(gitBadges, maxWidth));
    // L4: Config + PR
    const configPrBadges = [...buildConfigBadges(configCounts), ...buildPrBadges(prInfo)];
    if (configPrBadges.length > 0)
        lines.push(joinSegmentsWithWrap(configPrBadges, maxWidth));
    // L5: Learning loop + cctg
    const learnBadges = [
        ...(config.features.learning ? buildLearningBadges(learningStatus) : []),
        ...(config.features.cctg ? buildCctgBadge() : []),
    ];
    if (learnBadges.length > 0)
        lines.push(joinSegmentsWithWrap(learnBadges, maxWidth));
    // Separator between header and detail rows
    const semRuleWidth = Math.min(maxWidth || 60, 60);
    lines.push(`\x1b[38;2;60;60;60m${"─".repeat(semRuleWidth)}${reset()}`);
    // L6: Transcript + tools
    const transcriptToolRow = [buildTranscriptBadge(input.transcript_path)];
    if (transcriptData?.tools) {
        transcriptToolRow.push(...buildToolBadges(transcriptData.tools, input.workspace.current_dir));
    }
    lines.push(joinSegmentsWithWrap(transcriptToolRow, maxWidth));
    // L7: Agents
    if (transcriptData?.agents && transcriptData.agents.length > 0) {
        const agentBadges = buildAgentBadges(transcriptData.agents, input.workspace.current_dir);
        if (agentBadges.length > 0)
            lines.push(joinSegmentsWithWrap(agentBadges, maxWidth));
    }
    // L9: Todos
    if (transcriptData?.todos && transcriptData.todos.length > 0) {
        const todoBadges = buildTodoBadges(transcriptData.todos);
        if (todoBadges.length > 0)
            lines.push(joinSegmentsWithWrap(todoBadges, maxWidth));
    }
    return lines;
}
function buildAdaptiveLayout(data, maxWidth, config) {
    const { input, gitInfo, prInfo, transcriptData, configCounts, usageData, learningStatus } = data;
    const duration = getDuration(input);
    const allBadges = [
        ...buildIdentityBadges(input, usageData, duration),
        ...buildContextBadges(input),
        ...(config.features.usage ? buildUsageBadges(usageData) : []),
        ...buildGitBadges(gitInfo, input),
        ...buildConfigBadges(configCounts),
        ...buildPrBadges(prInfo),
        ...(config.features.learning ? buildLearningBadges(learningStatus) : []),
        ...(config.features.cctg ? buildCctgBadge() : []),
        buildTranscriptBadge(input.transcript_path),
    ];
    if (transcriptData?.tools) {
        allBadges.push(...buildToolBadges(transcriptData.tools, input.workspace.current_dir));
    }
    if (transcriptData?.agents && transcriptData.agents.length > 0) {
        allBadges.push(...buildAgentBadges(transcriptData.agents, input.workspace.current_dir));
    }
    if (transcriptData?.todos && transcriptData.todos.length > 0) {
        allBadges.push(...buildTodoBadges(transcriptData.todos));
    }
    return [joinSegmentsWithWrap(allBadges, maxWidth)];
}
// ============================================================================
// Config & Output
// ============================================================================
export function readStatuslineConfig() {
    try {
        const configPath = join(homedir(), ".claude", "statusline-config.json");
        if (!existsSync(configPath)) {
            return { layout: "dense", features: { usage: false, learning: false, cctg: false } };
        }
        const content = readFileSync(configPath, "utf8");
        const config = JSON.parse(content);
        const layout = config.layout;
        const validLayout = (layout === "semantic" || layout === "dense" || layout === "adaptive")
            ? layout
            : "dense";
        const features = config.features ?? {};
        return {
            layout: validLayout,
            features: {
                usage: features.usage === true,
                learning: features.learning === true,
                cctg: features.cctg === true,
            },
        };
    }
    catch { /* ignore */ }
    return { layout: "dense", features: { usage: false, learning: false, cctg: false } };
}
export function buildStatuslineOutput(data, maxWidth = 0, termWidth = 0, config = readStatuslineConfig()) {
    let lines;
    switch (config.layout) {
        case "semantic":
            lines = buildSemanticLayout(data, maxWidth, config);
            break;
        case "adaptive":
            lines = buildAdaptiveLayout(data, maxWidth, config);
            break;
        case "dense":
        default:
            lines = buildDenseLayout(data, maxWidth, config);
            break;
    }
    if (termWidth > 0 && termWidth < 80) {
        lines = lines.map(line => stripEmojis(line));
    }
    const ERASE_TO_EOL = "\x1b[K";
    let output = lines.map(line => line + reset() + ERASE_TO_EOL).join("\n");
    output = CLEAR_LINE_WITH_DEFAULT_BG + output + RESET_ALL + RESET_BG + RESET_FG;
    if (!output.includes("\n")) {
        output += "\n";
    }
    return output;
}
