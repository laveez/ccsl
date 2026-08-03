export interface CurrentUsage {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
}

export interface RateLimitWindow {
    used_percentage: number;
    resets_at: number;
}

export interface NativePrInfo {
    number: number;
    url: string;
    review_state?: "approved" | "pending" | "changes_requested" | "draft" | string;
}

export interface StatuslineInput {
    model: { id?: string; display_name: string };
    workspace: {
        current_dir: string;
        project_dir: string;
        added_dirs?: string[];
        git_worktree?: string;
        repo?: { host: string; owner: string; name: string };
    };
    version: string;
    transcript_path: string;
    session_id?: string;
    session_name?: string;
    output_style?: { name: string };
    fast_mode?: boolean;
    thinking?: { enabled: boolean };
    effort?: { level: string };
    agent?: { name: string };
    pr?: NativePrInfo;
    cost: {
        total_cost_usd: number;
        total_duration_ms: number;
        total_api_duration_ms?: number;
        total_lines_added: number;
        total_lines_removed: number;
    };
    context_window: {
        total_input_tokens: number;
        total_output_tokens: number;
        context_window_size: number;
        current_usage: CurrentUsage | null;
        used_percentage?: number | null;
        remaining_percentage?: number | null;
    };
    rate_limits?: {
        five_hour?: RateLimitWindow;
        seven_day?: RateLimitWindow;
    };
    exceeds_200k_tokens?: boolean;
    vim?: { mode: string };
    worktree?: {
        name: string;
        path: string;
        branch?: string;
        original_cwd?: string;
        original_branch?: string;
    };
}

export interface ConfigCounts {
    claudeMdCount: number;
    mcpCount: number;
    hooksCount: number;
}

export interface AgentEntry {
    id: string;
    type: string;
    model?: string;
    description?: string;
    status: "running" | "completed";
    startTime: Date;
    endTime?: Date;
}

export interface TodoItem {
    subject: string;
    status: "pending" | "in_progress" | "completed";
}

export interface ToolAggregation {
    running: { name: string; target?: string }[];
    completed: Map<string, number>;
}

export interface UsageData {
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: Date | null;
    sevenDayResetAt: Date | null;
}

export interface TranscriptData {
    tools: ToolAggregation;
    agents: AgentEntry[];
    todos: TodoItem[];
}

export interface GitFileStats {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
}

export interface GitRepoInfo {
    repo: string;
    worktree?: string;
    branch?: string;
    dirtyFiles?: number;
    outOfSync?: boolean;
    ahead?: number;
    behind?: number;
    fileStats?: GitFileStats;
}

export interface PrInfo {
    url: string;
    number: string;
    title?: string;
    isDraft?: boolean;
    state?: string;
    mergeStateStatus?: string;
    reviewDecision?: string;
}

export interface UnifiedStatuslineData {
    input: StatuslineInput;
    gitInfo: GitRepoInfo | null;
    prInfo: PrInfo | null;
    transcriptData: TranscriptData | null;
    configCounts: ConfigCounts | null;
    usageData: UsageData | null;
}

export type LayoutMode = "semantic" | "dense" | "adaptive";

export type BadgeGroup =
    | "identity" | "context" | "usage" | "usage7d" | "git" | "config" | "pr"
    | "transcript" | "tools" | "agents" | "todos";

export type RowConfig = (BadgeGroup[] | "---")[];

export const BADGE_GROUPS: BadgeGroup[] = [
    "identity", "context", "usage", "usage7d", "git", "config", "pr",
    "transcript", "tools", "agents", "todos",
];

export const PRESET_DENSE: RowConfig = [
    ["identity", "usage"],
    ["context", "usage7d", "config"],
    ["git", "pr"],
    "---",
    ["transcript", "tools"],
    ["agents"],
    ["todos"],
];

export const PRESET_SEMANTIC: RowConfig = [
    ["identity", "usage"],
    ["context", "usage7d"],
    ["git"],
    ["config", "pr"],
    "---",
    ["transcript", "tools"],
    ["agents"],
    ["todos"],
];

export const PRESET_ADAPTIVE: RowConfig = [
    ["identity", "usage", "context", "usage7d", "git", "config", "pr", "transcript", "tools", "agents", "todos"],
];

export const DEFAULT_ROWS: RowConfig = PRESET_DENSE;

export type FlexMode = "full" | "full-minus-40" | "full-until-compact";

export const BADGE = {
    blue:     [38, 60, 100] as const,
    green:    [38, 75, 48] as const,
    orange:   [95, 58, 28] as const,
    purple:   [65, 45, 88] as const,
    cyan:     [28, 75, 82] as const,
    rose:     [90, 38, 50] as const,
    gold:     [85, 70, 28] as const,
    steel:    [52, 56, 66] as const,
    olive:    [58, 68, 32] as const,
    charcoal: [46, 48, 54] as const,
};

export type BadgeColor = keyof typeof BADGE;

export type BadgeStyle = "flat" | "powerline" | "rounded" | string;

export interface CcslConfig {
    layout?: LayoutMode;
    rows?: RowConfig;
    flexMode?: FlexMode;
    compactThreshold?: number;
    flexPadding?: number;
    badgeSpacing?: boolean;
    badgeStyle?: BadgeStyle;
}
