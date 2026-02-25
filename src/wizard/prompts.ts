import type { BadgeGroup } from "../types.js";
import { BADGE_GROUPS } from "../types.js";
import { readKey, hideCursor, showCursor, eraseDown } from "./terminal.js";
import { cursor, dim, highlight, keyHint, sectionLabel, selectedRow as selectedRowStyle } from "./ui.js";

export interface SelectOption<T> {
    label: string;
    value: T;
    description?: string;
}

export async function selectPrompt<T>(
    label: string,
    options: SelectOption<T>[],
    defaultIndex: number = 0,
): Promise<T> {
    let selected = defaultIndex;
    hideCursor();

    const render = (): void => {
        process.stdout.write("\r");
        eraseDown();
        console.log(sectionLabel(label));
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const prefix = i === selected ? cursor() : "  ";
            const text = i === selected ? highlight(opt.label) : `  ${opt.label}`;
            const desc = opt.description ? ` ${dim(opt.description)}` : "";
            console.log(`${prefix}${text}${desc}`);
        }
        console.log(dim("  ↑↓ navigate  ⏎ select"));
    };

    render();

    while (true) {
        const key = await readKey();
        if (key.name === "ctrl-c") {
            showCursor();
            process.exit(130);
        }
        if (key.name === "up") {
            selected = (selected - 1 + options.length) % options.length;
        } else if (key.name === "down") {
            selected = (selected + 1) % options.length;
        } else if (key.name === "enter") {
            showCursor();
            // Clear prompt, show result
            const totalLines = options.length + 2; // label + options + hint
            process.stdout.write(`\x1b[${totalLines}A\r`);
            eraseDown();
            console.log(`${sectionLabel(label)} ${highlight(options[selected].label)}`);
            return options[selected].value;
        }
        // Re-render
        const totalLines = options.length + 2;
        process.stdout.write(`\x1b[${totalLines}A\r`);
        render();
    }
}

export async function togglePrompt(
    label: string,
    options: { key: string; label: string; enabled: boolean }[],
): Promise<Record<string, boolean>> {
    const state = options.map(o => ({ ...o }));
    let selected = 0;
    hideCursor();

    const render = (): void => {
        process.stdout.write("\r");
        eraseDown();
        console.log(sectionLabel(label));
        for (let i = 0; i < state.length; i++) {
            const opt = state[i];
            const prefix = i === selected ? cursor() : "  ";
            const toggle = opt.enabled ? "\x1b[38;2;100;200;100m● on\x1b[0m " : "\x1b[38;2;120;120;120m○ off\x1b[0m";
            console.log(`${prefix}  ${toggle}  ${opt.label}`);
        }
        console.log(dim("  ↑↓ navigate  space toggle  ⏎ done"));
    };

    render();

    while (true) {
        const key = await readKey();
        if (key.name === "ctrl-c") {
            showCursor();
            process.exit(130);
        }
        if (key.name === "up") {
            selected = (selected - 1 + state.length) % state.length;
        } else if (key.name === "down") {
            selected = (selected + 1) % state.length;
        } else if (key.name === "space") {
            state[selected].enabled = !state[selected].enabled;
        } else if (key.name === "enter") {
            showCursor();
            const totalLines = state.length + 2;
            process.stdout.write(`\x1b[${totalLines}A\r`);
            eraseDown();
            const summary = state.filter(o => o.enabled).map(o => o.label).join(", ") || "none";
            console.log(`${sectionLabel(label)} ${dim(summary)}`);
            const result: Record<string, boolean> = {};
            for (const opt of state) result[opt.key] = opt.enabled;
            return result;
        }
        const totalLines = state.length + 2;
        process.stdout.write(`\x1b[${totalLines}A\r`);
        render();
    }
}

export async function numberPrompt(
    label: string,
    defaultValue: number,
    opts: { min: number; max: number },
): Promise<number> {
    let value = String(defaultValue);
    showCursor();

    const render = (): void => {
        process.stdout.write("\r");
        eraseDown();
        console.log(`${sectionLabel(label)} ${dim(`(${opts.min}-${opts.max})`)}`);
        console.log(`  ${value}▌`);
        console.log(dim("  type number  ⏎ confirm"));
    };

    render();

    while (true) {
        const key = await readKey();
        if (key.name === "ctrl-c") {
            process.exit(130);
        }
        if (key.name === "backspace") {
            value = value.slice(0, -1);
        } else if (key.char && /[0-9]/.test(key.char)) {
            value += key.char;
        } else if (key.name === "enter") {
            const num = parseInt(value, 10);
            const clamped = Math.max(opts.min, Math.min(opts.max, isNaN(num) ? defaultValue : num));
            process.stdout.write(`\x1b[3A\r`);
            eraseDown();
            console.log(`${sectionLabel(label)} ${highlight(String(clamped))}`);
            return clamped;
        }
        process.stdout.write(`\x1b[3A\r`);
        render();
    }
}

const BADGE_DESCRIPTIONS: Record<BadgeGroup, string> = {
    identity: "Model, duration, cost",
    context: "Context bar, token breakdown",
    usage: "API rate limit bar",
    git: "Repo, branch, file stats",
    config: "CLAUDE.md, MCPs, hooks",
    pr: "Ticket marker, PR link",
    learning: "Recall, learn, instinct",
    remoteControl: "Remote control status",
    transcript: "Session transcript link",
    tools: "Running/completed tools",
    agents: "Running/completed agents",
    todos: "Todo progress",
};

type RowEntry = BadgeGroup[] | "---";

export async function rowEditor(rows: RowEntry[]): Promise<RowEntry[]> {
    let currentRows = rows.map(r => r === "---" ? "---" as const : [...r]);
    let selectedRow = 0;
    let mode: "navigate" | "edit-row" = "navigate";
    let editCursor = 0;
    hideCursor();

    const renderRows = (): void => {
        process.stdout.write("\r");
        eraseDown();
        console.log(sectionLabel("Row Layout"));
        console.log();

        for (let i = 0; i < currentRows.length; i++) {
            const row = currentRows[i];
            const isSel = i === selectedRow;
            const prefix = isSel ? cursor() : "  ";

            if (row === "---") {
                const sep = dim("──── separator ────");
                console.log(`${prefix}${isSel ? selectedRowStyle(sep) : sep}`);
                continue;
            }

            if (mode === "edit-row" && isSel) {
                // Edit mode: show badges with internal cursor
                const parts = row.map((g, j) => {
                    const desc = dim(` ${BADGE_DESCRIPTIONS[g]}`);
                    if (j === editCursor) return highlight(g) + desc;
                    return `  ${g}${desc}`;
                });
                console.log(`${prefix}${parts.join("  ")}`);
            } else {
                const badgeList = row.map(g => g).join(", ");
                console.log(`${prefix}${isSel ? selectedRowStyle(badgeList) : `  ${badgeList}`}`);
            }
        }

        console.log();
        if (mode === "navigate") {
            console.log(
                "  " + [
                    keyHint("↑↓", "move"),
                    keyHint("⏎", "edit row"),
                    keyHint("a", "add row"),
                    keyHint("s", "add separator"),
                    keyHint("d", "delete"),
                    keyHint("m/⇧↑↓", "reorder"),
                    keyHint("q", "done"),
                ].join("  "),
            );
        } else {
            console.log(
                "  " + [
                    keyHint("↑↓", "select badge"),
                    keyHint("space", "toggle"),
                    keyHint("←→", "move badge"),
                    keyHint("⏎/esc", "done editing"),
                ].join("  "),
            );
        }
    };

    renderRows();

    while (true) {
        const key = await readKey();
        if (key.name === "ctrl-c") {
            showCursor();
            process.exit(130);
        }

        const totalLines = currentRows.length + 4; // header + blank + rows + blank + hints

        if (mode === "navigate") {
            if (key.name === "up") {
                selectedRow = (selectedRow - 1 + currentRows.length) % currentRows.length;
            } else if (key.name === "down") {
                selectedRow = (selectedRow + 1) % currentRows.length;
            } else if (key.name === "enter") {
                const row = currentRows[selectedRow];
                if (row !== "---") {
                    mode = "edit-row";
                    editCursor = 0;
                }
            } else if (key.char === "a") {
                // Add new row after current
                currentRows.splice(selectedRow + 1, 0, []);
                selectedRow++;
                mode = "edit-row";
                editCursor = 0;
            } else if (key.char === "s") {
                currentRows.splice(selectedRow + 1, 0, "---");
                selectedRow++;
            } else if (key.char === "d") {
                if (currentRows.length > 1) {
                    currentRows.splice(selectedRow, 1);
                    if (selectedRow >= currentRows.length) selectedRow = currentRows.length - 1;
                }
            } else if (key.char === "m" || (key.name === "up" && key.shift)) {
                if (selectedRow > 0) {
                    [currentRows[selectedRow - 1], currentRows[selectedRow]] =
                        [currentRows[selectedRow], currentRows[selectedRow - 1]];
                    selectedRow--;
                }
            } else if ((key.name === "down" && key.shift)) {
                if (selectedRow < currentRows.length - 1) {
                    [currentRows[selectedRow], currentRows[selectedRow + 1]] =
                        [currentRows[selectedRow + 1], currentRows[selectedRow]];
                    selectedRow++;
                }
            } else if (key.char === "q" || key.name === "right") {
                showCursor();
                process.stdout.write(`\x1b[${totalLines}A\r`);
                eraseDown();
                const summary = currentRows.map(r =>
                    r === "---" ? "───" : r.join(","),
                ).join(" | ");
                console.log(`${sectionLabel("Row Layout")} ${dim(summary)}`);
                return currentRows;
            }
        } else {
            // edit-row mode
            const row = currentRows[selectedRow];
            if (row === "---") {
                mode = "navigate";
            } else if (key.name === "enter" || key.name === "escape") {
                // Remove empty rows
                if (row.length === 0) {
                    currentRows.splice(selectedRow, 1);
                    if (selectedRow >= currentRows.length) selectedRow = Math.max(0, currentRows.length - 1);
                }
                mode = "navigate";
            } else if (key.name === "up") {
                if (row.length === 0) continue;
                editCursor = (editCursor - 1 + row.length) % row.length;
            } else if (key.name === "down") {
                if (row.length === 0) continue;
                editCursor = (editCursor + 1) % row.length;
            } else if (key.name === "space") {
                // Toggle: show all badge groups, add/remove from this row
                await toggleBadgesInRow(row);
                if (editCursor >= row.length) editCursor = Math.max(0, row.length - 1);
            } else if (key.name === "left" && editCursor > 0) {
                [row[editCursor - 1], row[editCursor]] = [row[editCursor], row[editCursor - 1]];
                editCursor--;
            } else if (key.name === "right" && editCursor < row.length - 1) {
                [row[editCursor], row[editCursor + 1]] = [row[editCursor + 1], row[editCursor]];
                editCursor++;
            }
        }

        process.stdout.write(`\x1b[${totalLines}A\r`);
        renderRows();
    }
}

async function toggleBadgesInRow(row: BadgeGroup[]): Promise<void> {
    const inRow = new Set(row);
    const options = BADGE_GROUPS.map(g => ({
        key: g,
        label: `${g} — ${BADGE_DESCRIPTIONS[g]}`,
        enabled: inRow.has(g),
    }));
    const result = await togglePrompt("Badges in this row", options);

    // Rebuild row: keep existing order for enabled, append newly enabled
    const kept = row.filter(g => result[g]);
    const added = BADGE_GROUPS.filter(g => result[g] && !inRow.has(g));
    row.length = 0;
    row.push(...kept, ...added);
}
