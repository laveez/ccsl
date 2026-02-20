import type { UnifiedStatuslineData, CcslConfig } from "./types.js";
export declare function renderContextBar(percent: number, width?: number): string;
export declare function renderUsageBar(percent: number | null, width?: number): string;
export declare function readStatuslineConfig(): CcslConfig;
export declare function buildStatuslineOutput(data: UnifiedStatuslineData, maxWidth?: number, termWidth?: number, config?: CcslConfig): string;
