import type { UnifiedStatuslineData, CcslConfig } from "../types.js";
import { buildStatuslineOutput } from "../render.js";
import { boxTop, boxBottom, dim } from "./ui.js";

export function generateMockData(): UnifiedStatuslineData {
    return {
        input: {
            model: { display_name: "Opus" },
            workspace: {
                current_dir: "/Users/dev/my-project",
                project_dir: "/Users/dev/my-project",
            },
            version: "1.0.80",
            transcript_path: "/tmp/transcript-abc123.jsonl",
            cost: {
                total_cost_usd: 4.82,
                total_duration_ms: 1854000,
                total_lines_added: 284,
                total_lines_removed: 67,
            },
            context_window: {
                total_input_tokens: 95000,
                total_output_tokens: 18000,
                context_window_size: 200000,
                current_usage: {
                    input_tokens: 28000,
                    cache_creation_input_tokens: 45000,
                    cache_read_input_tokens: 22000,
                },
            },
        },
        gitInfo: {
            repo: "my-project",
            branch: "feature/user-auth",
            fileStats: { modified: 3, added: 1, deleted: 0, untracked: 2 },
            ahead: 2,
            behind: 0,
        },
        prInfo: {
            url: "https://github.com/user/my-project/pull/42",
            number: "42",
            title: "PROJ-123 Add user authentication",
            isDraft: false,
            state: "OPEN",
            mergeStateStatus: "CLEAN",
        },
        transcriptData: {
            tools: {
                running: [{ name: "Bash", target: "npm test --coverage" }],
                completed: new Map([
                    ["Read", 7],
                    ["Edit", 5],
                    ["Grep", 4],
                    ["Glob", 3],
                    ["Write", 2],
                    ["Bash", 6],
                    ["Task", 2],
                ]),
            },
            agents: [
                {
                    id: "a1",
                    type: "code-reviewer",
                    description: "Review auth implementation",
                    status: "completed",
                    startTime: new Date(Date.now() - 45000),
                    endTime: new Date(Date.now() - 12000),
                },
                {
                    id: "a2",
                    type: "general-purpose",
                    description: "Generate test fixtures",
                    status: "running",
                    startTime: new Date(Date.now() - 8000),
                },
            ],
            todos: [
                { subject: "Extract types into separate module", status: "completed" },
                { subject: "Refactor render pipeline", status: "completed" },
                { subject: "Add rate limiting", status: "in_progress" },
                { subject: "Write unit tests", status: "pending" },
                { subject: "Update documentation", status: "pending" },
            ],
            sessionStart: new Date(Date.now() - 1854000),
        },
        configCounts: { claudeMdCount: 3, mcpCount: 5, hooksCount: 4 },
        usageData: {
            planName: "Max",
            fiveHour: 34,
            sevenDay: 12,
            fiveHourResetAt: new Date(Date.now() + 4 * 3600 * 1000),
            sevenDayResetAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        },
        learningStatus: {
            recalledThisSession: true,
            learningPending: false,
            autoLearn: true,
            lastLearnedDate: "Feb 24",
            instinctStatus: {
                activeCount: 12,
                promotableCount: 2,
                correctionsThisSession: 0,
                unprocessedObservations: 3,
            },
        },
    };
}

export function renderPreview(config: CcslConfig, termWidth: number): string {
    const mockData = generateMockData();
    const maxWidth = Math.min(termWidth - 4, 120);
    const output = buildStatuslineOutput(mockData, maxWidth, termWidth, config);

    const lines: string[] = [];
    const boxWidth = Math.min(termWidth, 130);
    lines.push(boxTop(boxWidth));
    lines.push(dim("  Preview:"));
    lines.push("");

    // The output already has ANSI formatting; indent each line
    const outputLines = output.split("\n").filter(l => l.length > 0);
    for (const line of outputLines) {
        lines.push(`  ${line}`);
    }

    lines.push("");
    lines.push(boxBottom(boxWidth));
    return lines.join("\n");
}
