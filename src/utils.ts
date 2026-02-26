import { homedir } from "node:os";

import type {
    CurrentUsage,
    StatuslineInput,
    GitFileStats,
    PrInfo,
    BadgeColor,
} from "./types.js";
import { BADGE } from "./types.js";

// ANSI color helpers
export function bgRgb(r: number, g: number, b: number): string {
    return `\x1b[48;2;${r};${g};${b}m`;
}

export function fgWhite(): string {
    return "\x1b[97m";
}

export function fgBlack(): string {
    return "\x1b[30m";
}

export function reset(): string {
    return "\x1b[0m";
}

export const CLEAR_LINE_WITH_DEFAULT_BG = "\x1b[0m\x1b[49m\x1b[2K\r";
export const RESET_ALL = "\x1b[0m";
export const RESET_BG = "\x1b[49m";
export const RESET_FG = "\x1b[39m";

// Strip ANSI escape codes to get visible text length
export function stripAnsi(str: string): string {
    const withoutOsc = str.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
    return withoutOsc.replace(/\x1b\[[0-9:;?]*(?:[ -\/]*[@-~])/g, "");
}

// Strip XML-like tags and clean up error messages
export function cleanErrorMessage(str: string): string {
    let cleaned = str;
    let prev;
    do { prev = cleaned; cleaned = cleaned.replace(/<[^>]+>/g, ""); } while (cleaned !== prev);
    cleaned = cleaned.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    cleaned = cleaned.replace(/\.\s*Current working directory:\s*\S+/i, "");
    return cleaned;
}

export function colorSegment(
    bgR: number,
    bgG: number,
    bgB: number,
    text: string,
): string {
    return `${bgRgb(bgR, bgG, bgB)}${fgWhite()} ${text} ${reset()}`;
}

function isWideChar(code: number): boolean {
    return (
        // CJK and fullwidth
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2329 && code <= 0x232a) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        // Emoji with default emoji presentation (width 2 in terminals)
        (code >= 0x23e9 && code <= 0x23f3) ||   // ⏩-⏳ (includes ⏲)
        (code >= 0x25aa && code <= 0x25ab) ||   // ▪▫
        (code >= 0x25fb && code <= 0x25fe) ||   // ◻◼◽◾
        (code >= 0x2614 && code <= 0x2615) ||   // ☔☕
        (code >= 0x2648 && code <= 0x2653) ||   // ♈-♓
        (code >= 0x26aa && code <= 0x26ab) ||   // ⚪⚫
        (code === 0x26a1) ||                     // ⚡
        (code === 0x2705) ||                     // ✅
        (code === 0x2728) ||                     // ✨
        (code >= 0x1f300 && code <= 0x1f64f) ||
        (code >= 0x1f680 && code <= 0x1f6ff) || // Transport/map symbols
        (code >= 0x1f900 && code <= 0x1f9ff) ||
        (code >= 0x1fa00 && code <= 0x1fa6f) || // Chess, extended-A
        (code >= 0x1fa70 && code <= 0x1faff)    // Symbols extended-A
    );
}

export function getVisibleWidth(str: string): number {
    const plain = stripAnsi(str);
    let width = 0;
    for (let i = 0; i < plain.length; i++) {
        const code = plain.codePointAt(i) || 0;
        if (code > 0xffff) i++;
        width += isWideChar(code) ? 2 : 1;
    }
    return width;
}

export function truncateToWidth(str: string, maxWidth: number): string {
    if (maxWidth <= 0) return reset();
    if (getVisibleWidth(str) <= maxWidth) return str;

    let visibleWidth = 0;
    let result = "";
    let i = 0;

    while (i < str.length && visibleWidth < maxWidth) {
        if (str[i] === "\x1b" && i + 1 < str.length) {
            if (str[i + 1] === "[") {
                let j = i + 2;
                while (j < str.length && !/[@A-Z\[\]^_`a-z{|}~]/.test(str[j])) j++;
                if (j < str.length) j++;
                result += str.slice(i, j);
                i = j;
                continue;
            }
            if (str[i + 1] === "]") {
                let j = i + 2;
                while (j < str.length) {
                    if (str[j] === "\x07") { j++; break; }
                    if (str[j] === "\x1b" && j + 1 < str.length && str[j + 1] === "\\") { j += 2; break; }
                    j++;
                }
                result += str.slice(i, j);
                i = j;
                continue;
            }
        }

        const code = str.codePointAt(i) || 0;
        const charWidth = isWideChar(code) ? 2 : 1;

        if (visibleWidth + charWidth > maxWidth) break;

        if (code > 0xffff) {
            result += str.slice(i, i + 2);
            i += 2;
        } else {
            result += str[i];
            i++;
        }
        visibleWidth += charWidth;
    }

    return result + reset();
}

export function joinSegmentsWithWrap(
    segments: string[],
    maxWidth: number,
): string {
    if (maxWidth <= 0) {
        return segments.join("");
    }

    let output = "";
    let currentLineWidth = 0;

    for (const segment of segments) {
        const segmentWidth = getVisibleWidth(segment);

        if (
            currentLineWidth > 0 &&
            currentLineWidth + segmentWidth > maxWidth
        ) {
            output += reset() + "\x1b[K\n";
            currentLineWidth = 0;
        }

        output += segment;
        output += reset();
        output += " ";
        currentLineWidth += segmentWidth + 1;
    }

    return output;
}

// Muted color palette for better contrast
export const COLORS = {
    barGreen: "\x1b[38;2;100;180;100m",
    barYellow: "\x1b[38;2;200;180;80m",
    barRed: "\x1b[38;2;200;100;100m",
    barEmpty: "\x1b[38;2;80;80;80m",
    dim: "\x1b[38;2;140;140;140m",
    bright: "\x1b[38;2;220;220;220m",
    cyan: "\x1b[38;2;100;180;180m",
    purple: "\x1b[38;2;160;140;180m",
    blue: "\x1b[38;2;120;160;200m",
    green: "\x1b[38;2;140;180;140m",
};

export type RGB = readonly [number, number, number];

export function lerpColor(from: RGB, to: RGB, t: number): [number, number, number] {
    return [
        Math.round(from[0] + (to[0] - from[0]) * t),
        Math.round(from[1] + (to[1] - from[1]) * t),
        Math.round(from[2] + (to[2] - from[2]) * t),
    ];
}

export function gradientColor(stops: [number, RGB][], value: number): RGB {
    if (value <= stops[0][0]) return stops[0][1];
    if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (value <= stops[i + 1][0]) {
            const t = (value - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
            return lerpColor(stops[i][1], stops[i + 1][1], t);
        }
    }
    return stops[stops.length - 1][1];
}

export function badgeGradient(bg: RGB, text: string): string {
    return colorSegment(bg[0], bg[1], bg[2], text);
}

export function badge(color: BadgeColor, text: string): string {
    const [r, g, b] = BADGE[color];
    return colorSegment(r, g, b, text);
}

export function badgeRich(color: BadgeColor, text: string): string {
    const [r, g, b] = BADGE[color];
    return `${bgRgb(r, g, b)} ${text} ${reset()}`;
}

export function formatTokenCount(n: number): string {
    if (n >= 1000) {
        const k = n / 1000;
        return k >= 10 ? `${Math.floor(k)}k` : `${k.toFixed(1)}k`;
    }
    return String(n);
}

export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    if (minutes >= 10) {
        return `${minutes}m`;
    }
    if (minutes > 0) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }
    return `${seconds}s`;
}

export function formatTimeUntil(date: Date | null): string {
    if (!date) return "";
    const now = Date.now();
    const diffMs = date.getTime() - now;
    if (diffMs <= 0) return "now";

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

export function formatFileStats(stats: GitFileStats | undefined): string {
    if (!stats) return "";
    const parts: string[] = [];
    if (stats.modified > 0) parts.push(`!${stats.modified}`);
    if (stats.added > 0) parts.push(`+${stats.added}`);
    if (stats.deleted > 0) parts.push(`✘${stats.deleted}`);
    if (stats.untracked > 0) parts.push(`?${stats.untracked}`);
    return parts.join("");
}

export function formatToolCall(toolName: string, input?: Record<string, unknown>, cwd?: string): string {
    if (!input) {
        return `${toolName}()`;
    }

    const paramMap: Record<string, string> = {
        Read: "file_path",
        Edit: "file_path",
        Write: "file_path",
        Bash: "command",
        WebFetch: "url",
        WebSearch: "query",
        Grep: "pattern",
        Glob: "pattern",
        Task: "prompt",
        NotebookEdit: "notebook_path",
        Skill: "skill",
        AskUserQuestion: "questions",
    };

    const filePathTools = new Set(["Read", "Edit", "Write", "NotebookEdit"]);

    const mainParam = paramMap[toolName];

    if (mainParam && input[mainParam] !== undefined) {
        const value = input[mainParam];
        let valueStr = typeof value === "string" ? value : JSON.stringify(value);

        if (cwd && filePathTools.has(toolName) && typeof value === "string") {
            valueStr = makeRelativePath(value, cwd);
        }

        const maxLen = 80;
        const truncated = valueStr.length > maxLen
            ? valueStr.substring(0, maxLen) + "..."
            : valueStr;
        return `${toolName}(${truncated})`;
    }

    const inputStr = JSON.stringify(input);
    const maxLen = 100;
    const truncated = inputStr.length > maxLen
        ? inputStr.substring(0, maxLen) + "..."
        : inputStr;
    return `${toolName}(${truncated})`;
}

export function makeRelativePath(path: string, cwd: string): string {
    const cwdNormalized = cwd.endsWith("/") ? cwd : cwd + "/";
    if (path.startsWith(cwdNormalized)) {
        return path.substring(cwdNormalized.length);
    }
    const home = homedir();
    if (path.startsWith(home + "/")) {
        return "~" + path.substring(home.length);
    }
    return path;
}


export const EMOJI_REPLACEMENTS: [RegExp, string][] = [
    [/\ud83e\udde0/g, "ctx"],     // 🧠
    [/\ud83d\udcca/g, "+/-"],     // 📊
    [/\ud83d\udd25/g, "tok"],     // 🔥
    [/\ud83d\udcb8/g, "$"],       // 💸
    [/\u23f2/g, "T"],             // ⏲
    [/\ud83c\udf33/g, "wt:"],     // 🌳
    [/\ud83c\udf3f/g, "br:"],     // 🌿
    [/\ud83d\udccb/g, "cfg"],     // 📋
    [/\ud83c\udfab/g, "tkt"],     // 🎫
    [/\ud83d\udd17/g, "PR"],      // 🔗
    [/\ud83e\udde9/g, "R"],       // 🧩
    [/\ud83d\udcda/g, "L"],       // 📚
    [/\ud83d\udce6/g, "C"],       // 📦
    [/\ud83e\uddec/g, "I"],       // 🧬
    [/\ud83d\udcdd/g, "log"],     // 📝
    [/\ud83d\udd0c/g, "mcp:"],   // 🔌
    [/\ud83d\udcf1/g, "TG"],     // 📱
];

export function stripEmojis(text: string): string {
    let result = text;
    for (const [pattern, replacement] of EMOJI_REPLACEMENTS) {
        result = result.replace(pattern, replacement);
    }
    return result;
}

export function getShortMcpName(fullName: string): string {
    const parts = fullName.split("__");
    if (parts.length < 3) return fullName;
    const server = parts[1];
    const words = server.split(/[-_]/).filter(w => w.length > 0);
    const unique = [...new Set(words)];
    return unique[unique.length - 1] || server;
}

export function getToolDisplayName(fullName: string): string {
    if (!fullName.startsWith("mcp__")) return fullName;
    const parts = fullName.split("__");
    if (parts.length < 3) return fullName;
    const serverShort = getShortMcpName(fullName);
    const action = parts.slice(2).join("_").replace(/^browser_/, "");
    return `${serverShort}:${action}`;
}

export function extractRepoName(toplevelPath: string): string {
    return toplevelPath.trim().split("/").pop() || "";
}

export function extractRepoNameFromCommonDir(commonDir: string): string | null {
    const trimmed = commonDir.trim();
    if (!trimmed.endsWith(".git") && !trimmed.endsWith(".git/")) {
        return null;
    }
    const withoutGit = trimmed.replace(/\/\.git\/?$/, "");
    const parts = withoutGit.split("/");
    return parts.pop() || null;
}

export function extractWorktreeName(toplevelPath: string): string {
    return toplevelPath.trim().split("/").pop() || "";
}

export function getModelName(input: StatuslineInput): string {
    return input.model.display_name;
}

export function getProjectDir(input: StatuslineInput): string {
    return input.workspace.current_dir || input.workspace.project_dir;
}

export function getCost(input: StatuslineInput): number {
    return input.cost.total_cost_usd;
}

export function getDuration(input: StatuslineInput): number {
    return input.cost.total_duration_ms;
}

export function getContextWindowSize(input: StatuslineInput): number {
    return input.context_window.context_window_size;
}

export function getCurrentUsage(input: StatuslineInput): CurrentUsage | null {
    return input.context_window.current_usage;
}

export function calculateCurrentTokens(usage: CurrentUsage | null): number {
    if (!usage) return 0;
    return (
        usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens
    );
}

export function calculatePercentUsed(
    currentTokens: number,
    contextSize: number,
): number {
    if (contextSize === 0) return 0;
    return Math.floor((currentTokens * 100) / contextSize);
}

export function extractTicketMarker(title: string): string | null {
    const match = title.match(/^([A-Z]{2,6}-\d{1,5})/);
    return match ? match[1] : null;
}

export function getPrStatusSuffix(prInfo: PrInfo): string {
    if (prInfo.isDraft) return " (D)";
    if (prInfo.state === "MERGED") return " (M)";
    if (prInfo.state === "CLOSED") return " (C)";
    if (prInfo.state === "OPEN" && prInfo.mergeStateStatus === "CLEAN")
        return " (✅)";
    if (prInfo.state === "OPEN") return " (O)";
    return "";
}
