import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { BadgeGroup, CcslConfig, FlexMode, RowConfig } from "../types.js";
import { DEFAULT_ROWS, PRESET_DENSE, PRESET_SEMANTIC, PRESET_ADAPTIVE } from "../types.js";
import { readStatuslineConfig } from "../render.js";
import { enableRawMode, disableRawMode, showCursor, clearScreen } from "./terminal.js";
import { selectPrompt, togglePrompt, numberPrompt, rowEditor } from "./prompts.js";
import { renderPreview } from "./preview.js";
import { header, separator, dim, sectionLabel } from "./ui.js";

export async function runWizard(): Promise<void> {
    if (!process.stdin.isTTY) {
        console.error("ccsl setup requires an interactive terminal.");
        process.exit(1);
    }

    enableRawMode();

    try {
        clearScreen();
        console.log(header(" ccsl setup "));
        console.log(dim("  Configure your Claude Code statusline layout\n"));

        // 1. Load existing config
        const existing = readStatuslineConfig();

        // 2. Starting point
        const preset = await selectPrompt<"dense" | "semantic" | "adaptive" | "current">(
            "Starting point",
            [
                { label: "Dense", value: "dense", description: "Compact multi-row layout (default)" },
                { label: "Semantic", value: "semantic", description: "One category per row" },
                { label: "Adaptive", value: "adaptive", description: "Single auto-wrapping line" },
                { label: "Current config", value: "current", description: "Keep your existing layout" },
            ],
        );
        console.log();

        let rows: RowConfig;
        switch (preset) {
            case "dense": rows = structuredClone(PRESET_DENSE); break;
            case "semantic": rows = structuredClone(PRESET_SEMANTIC); break;
            case "adaptive": rows = structuredClone(PRESET_ADAPTIVE); break;
            case "current": rows = structuredClone(existing.rows ?? DEFAULT_ROWS); break;
        }

        // 3. Row editor
        rows = await rowEditor(rows) as RowConfig;
        console.log();

        // 4. Flex settings
        const flexMode = await selectPrompt<FlexMode>(
            "Flex width mode",
            [
                { label: "full-until-compact", value: "full-until-compact", description: "Full width, shrinks when context is high" },
                { label: "full", value: "full", description: "Always use full terminal width" },
                { label: "full-minus-40", value: "full-minus-40", description: "Always leave 40 cols for notifications" },
            ],
            ["full-until-compact", "full", "full-minus-40"].indexOf(existing.flexMode ?? "full-until-compact"),
        );
        console.log();

        let compactThreshold = existing.compactThreshold ?? 85;
        let flexPadding = existing.flexPadding ?? 50;

        if (flexMode === "full-until-compact") {
            compactThreshold = await numberPrompt(
                "Compact threshold (%)",
                compactThreshold,
                { min: 60, max: 99 },
            );
        }

        flexPadding = await numberPrompt(
            "Flex padding (cols)",
            flexPadding,
            { min: 0, max: 200 },
        );
        console.log();

        // 5. Feature toggles
        const features = await togglePrompt("Optional features", [
            { key: "usage", label: "API usage rate limit bar", enabled: existing.features.usage },
            { key: "learning", label: "Learning loop status", enabled: existing.features.learning },
            { key: "remoteControl", label: "Remote control status", enabled: existing.features.remoteControl },
        ]);
        console.log();

        // Build config
        const config: CcslConfig = {
            rows,
            flexMode,
            ...(flexMode === "full-until-compact" ? { compactThreshold } : {}),
            flexPadding,
            features: {
                usage: features.usage ?? false,
                learning: features.learning ?? false,
                remoteControl: features.remoteControl ?? false,
            },
        };

        // 6. Preview
        const termWidth = process.stdout.columns || 120;
        console.log(renderPreview(config, termWidth));
        console.log();

        // 7. Confirm & save
        const action = await selectPrompt<"save" | "discard">(
            "Save this configuration?",
            [
                { label: "Save", value: "save", description: "Write to ~/.claude/statusline-config.json" },
                { label: "Discard", value: "discard", description: "Exit without saving" },
            ],
        );

        if (action === "save") {
            try {
                const configDir = join(homedir(), ".claude");
                mkdirSync(configDir, { recursive: true });
                const configPath = join(configDir, "statusline-config.json");
                writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
                console.log(`\n${sectionLabel("Saved")} ${dim(configPath)}`);
            } catch (err) {
                console.error(`\n${sectionLabel("Error")} Failed to save: ${dim(err instanceof Error ? err.message : String(err))}`);
            }
        } else {
            console.log(`\n${dim("Discarded — no changes made.")}`);
        }
    } finally {
        showCursor();
        disableRawMode();
    }
}
