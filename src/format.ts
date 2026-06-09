export const DEFAULT_RESERVE_TOKENS = 16_384;
export const DEFAULT_DUMB_ZONE_WARNING_RATIO = 0.75;

export type ContextTokenSeverity = "normal" | "warning" | "dumb";

export function formatExactTokens(count: number | null | undefined): string {
	if (count === null || count === undefined || !Number.isFinite(count)) return "?";
	return Math.max(0, Math.round(count)).toLocaleString("en-US");
}

export function formatCompactTokens(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "0";
	if (count < 1000) return Math.round(count).toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function getDumbZoneStart(
	contextWindow: number,
	reserveTokens: number,
	configuredDumbZoneStartTokens?: number,
): number {
	if (configuredDumbZoneStartTokens !== undefined) return configuredDumbZoneStartTokens;
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
	if (!Number.isFinite(reserveTokens) || reserveTokens < 0) return contextWindow;
	return Math.max(0, contextWindow - reserveTokens);
}

export function getContextTokenSeverity(
	tokens: number | null | undefined,
	dumbZoneStartTokens: number,
	warningRatio = DEFAULT_DUMB_ZONE_WARNING_RATIO,
): ContextTokenSeverity {
	if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return "normal";
	if (!Number.isFinite(dumbZoneStartTokens) || dumbZoneStartTokens <= 0) return "normal";

	if (tokens >= dumbZoneStartTokens) return "dumb";
	if (tokens >= dumbZoneStartTokens * warningRatio) return "warning";
	return "normal";
}

export function formatContextTokenDisplay(tokens: number | null | undefined): string {
	return `${formatExactTokens(tokens)} tok`;
}

export function formatContextWindowDisplay(contextWindow: number): string {
	return `${contextWindow > 0 ? formatCompactTokens(contextWindow) : "?"} ctx`;
}

export function formatContextPercentDisplay(tokens: number | null | undefined, contextWindow: number): string {
	if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return "?%";
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return "?%";
	return `${((tokens / contextWindow) * 100).toFixed(1)}%`;
}

export function formatCostDisplay(cost: number, usingSubscription: boolean): string {
	const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
	const decimals = safeCost > 0 && safeCost < 0.01 ? 3 : 2;
	return `$${safeCost.toFixed(decimals)}${usingSubscription ? " (sub)" : ""}`;
}
