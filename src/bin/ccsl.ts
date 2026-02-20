#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../statusline.js";

const arg = process.argv[2];
if (arg === "--help" || arg === "-h") {
    console.log("ccsl — Claude Code Statusline\n");
    console.log("Usage: Pipe Claude Code status JSON to stdin.");
    console.log("  Configured in ~/.claude/settings.json as a statusLine command.\n");
    console.log("Options:");
    console.log("  --help, -h       Show this help message");
    console.log("  --version, -v    Show version number");
    process.exit(0);
}
if (arg === "--version" || arg === "-v") {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
    console.log(pkg.version);
    process.exit(0);
}

main().catch(() => process.exit(1));
