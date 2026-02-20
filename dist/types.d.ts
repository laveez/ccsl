export interface CurrentUsage {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
}
export interface StatuslineInput {
    model: {
        display_name: string;
    };
    workspace: {
        current_dir: string;
        project_dir: string;
    };
    version: string;
    transcript_path: string;
    output_style?: {
        name: string;
    };
    cost: {
        total_cost_usd: number;
        total_duration_ms: number;
        total_lines_added: number;
        total_lines_removed: number;
    };
    context_window: {
        total_input_tokens: number;
        total_output_tokens: number;
        context_window_size: number;
        current_usage: CurrentUsage | null;
    };
}
export interface ConfigCounts {
    claudeMdCount: number;
    rulesCount: number;
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
    running: {
        name: string;
        target?: string;
    }[];
    completed: Map<string, number>;
}
export interface UsageData {
    planName: string | null;
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: Date | null;
    sevenDayResetAt: Date | null;
    apiUnavailable?: boolean;
}
export interface TranscriptData {
    tools: ToolAggregation;
    agents: AgentEntry[];
    todos: TodoItem[];
    sessionStart?: Date;
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
}
export interface ToolInfo {
    name: string;
    input?: Record<string, unknown>;
    result?: string;
    isSuccess?: boolean;
    isError?: boolean;
    errorMessage?: string;
    durationMs?: number;
}
export interface LearningStatus {
    recalledThisSession: boolean;
    learningPending: boolean;
    autoLearn: boolean;
    lastLearnedDate: string | null;
}
export interface UnifiedStatuslineData {
    input: StatuslineInput;
    gitInfo: GitRepoInfo | null;
    prInfo: PrInfo | null;
    transcriptData: TranscriptData | null;
    configCounts: ConfigCounts | null;
    usageData: UsageData | null;
    learningStatus: LearningStatus | null;
}
export type LayoutMode = "semantic" | "dense" | "adaptive";
export declare const BADGE: {
    blue: readonly [38, 60, 100];
    green: readonly [38, 75, 48];
    orange: readonly [95, 58, 28];
    purple: readonly [65, 45, 88];
    cyan: readonly [28, 75, 82];
    rose: readonly [90, 38, 50];
    gold: readonly [85, 70, 28];
    steel: readonly [52, 56, 66];
    olive: readonly [58, 68, 32];
    charcoal: readonly [46, 48, 54];
};
export type BadgeColor = keyof typeof BADGE;
export interface CcslConfig {
    layout: LayoutMode;
    features: {
        usage: boolean;
        learning: boolean;
        cctg: boolean;
    };
}
