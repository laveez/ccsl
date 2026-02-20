#!/usr/bin/env node
import { main } from "../statusline.js";
main().catch(() => process.exit(1));
