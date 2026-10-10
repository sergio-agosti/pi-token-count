import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	formatContextTokenDisplay,
	getContextTokenSeverity,
	getDumbZoneStart,
	type ContextTokenSeverity,
} from "./format.ts";
import { CompactionSettingsCache, setDumbZoneStartTokens, type DumbZoneSettingsScope } from "./settings.ts";
import { CONTEXT_TOKENS_UPDATED_EVENT, buildContextFeed } from "./feed.ts";

// Pi renders the extension status line sorted alphabetically by key, so this
// key is chosen to sort before pi-quotas' "pi-quotas-usage" entry and keep the
// token count ahead of the usage readout.
const STATUS_KEY = "context-tokens";

function colorContextDisplay(theme: Theme, severity: ContextTokenSeverity, text: string): string {
	switch (severity) {
		case "dumb":
			return theme.fg("error", text);
		case "warning":
			return theme.fg("warning", text);
		case "normal":
			return theme.fg("dim", text);
	}
}

function parseScope(text: string): DumbZoneSettingsScope | undefined {
	const normalized = text.trim().toLowerCase();
	if (normalized === "global" || normalized === "user") return "global";
	if (normalized === "project" || normalized === "local") return "project";
	return undefined;
}

function parseTokenCountText(text: string): number | undefined {
	const normalized = text.trim().toLowerCase().replace(/[, _]/g, "");
	const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(normalized);
	if (!match) return undefined;

	const value = Number(match[1]);
	const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
	const tokens = Math.floor(value * multiplier);
	return Number.isFinite(tokens) && tokens > 0 ? tokens : undefined;
}

function parseDumbZoneCommandArgs(args: string): {
	scope?: DumbZoneSettingsScope;
	tokens?: number;
	error?: string;
} {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return {};

	let scope: DumbZoneSettingsScope | undefined;
	let tokenText: string | undefined;

	const firstScope = parseScope(parts[0]);
	if (firstScope) {
		scope = firstScope;
		tokenText = parts[1];
		if (parts.length > 2) return { error: "Usage: /dumb-zone [project|global] <tokens>" };
	} else {
		tokenText = parts[0];
		if (parts.length > 1) return { error: "Usage: /dumb-zone [project|global] <tokens>" };
	}

	if (!tokenText) return { scope };
	const tokens = parseTokenCountText(tokenText);
	if (!tokens) return { error: `Invalid token count: ${tokenText}` };
	return { scope, tokens };
}

function scopeLabel(scope: DumbZoneSettingsScope): string {
	return scope === "global" ? "Global (~/.pi/agent/settings.json)" : "Project (.pi/settings.json)";
}

function scopeFromLabel(label: string): DumbZoneSettingsScope | undefined {
	if (label.startsWith("Global")) return "global";
	if (label.startsWith("Project")) return "project";
	return undefined;
}

function formatTokenCountForNotice(tokens: number): string {
	return `${Math.round(tokens).toLocaleString("en-US")} tok`;
}

export default function piTokenCount(pi: ExtensionAPI) {
	const settingsCache = new CompactionSettingsCache();

	function updateStatus(ctx: ExtensionContext): void {
		const contextUsage = ctx.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const contextTokens = contextUsage?.tokens ?? null;
		const compactionSettings = settingsCache.get(ctx.cwd);
		const dumbZoneStart = getDumbZoneStart(
			contextWindow,
			compactionSettings.reserveTokens,
			compactionSettings.dumbZoneStartTokens,
		);
		const contextSeverity = getContextTokenSeverity(
			contextTokens,
			dumbZoneStart,
			compactionSettings.warningRatio,
		);
		const tokenText = colorContextDisplay(
			ctx.ui.theme,
			contextSeverity,
			formatContextTokenDisplay(contextTokens),
		);
		ctx.ui.setStatus(STATUS_KEY, tokenText);
		// Published alongside the text so a consumer can place the dumb-zone tick
		// from the same threshold that coloured it. Re-emitted whenever the
		// threshold changes, so the tick moves with the setting.
		pi.events.emit(
			CONTEXT_TOKENS_UPDATED_EVENT,
			buildContextFeed({
				statusKey: STATUS_KEY,
				tokens: contextTokens,
				contextWindow,
				dumbZoneStart,
				severity: contextSeverity,
			}),
		);
	}

	pi.registerCommand("dumb-zone", {
		description: "Configure the pi-token-count dumb zone token threshold",
		getArgumentCompletions: (prefix: string) => {
			const completions = ["project ", "global ", "160000", "200000", "1m"];
			const matching = completions
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value.trim() }));
			return matching.length > 0 ? matching : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseDumbZoneCommandArgs(args);
			if (parsed.error) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}

			let scope = parsed.scope;
			let tokens = parsed.tokens;

			if (!scope) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Usage: /dumb-zone [project|global] <tokens>", "error");
					return;
				}

				const selected = await ctx.ui.select("Save dumb zone setting to:", [scopeLabel("project"), scopeLabel("global")]);
				if (!selected) return;
				scope = scopeFromLabel(selected);
				if (!scope) return;
			}

			if (!tokens) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Usage: /dumb-zone [project|global] <tokens>", "error");
					return;
				}

				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const currentSettings = settingsCache.get(ctx.cwd);
				const currentDumbZoneStart = getDumbZoneStart(
					contextWindow,
					currentSettings.reserveTokens,
					currentSettings.dumbZoneStartTokens,
				);
				const placeholder = currentDumbZoneStart > 0 ? String(currentDumbZoneStart) : "160000";
				const input = await ctx.ui.input("Dumb zone starts at token count:", placeholder);
				if (!input) return;

				tokens = parseTokenCountText(input);
				if (!tokens) {
					ctx.ui.notify(`Invalid token count: ${input}`, "error");
					return;
				}
			}

			try {
				const settingsPath = setDumbZoneStartTokens(ctx.cwd, scope, tokens);
				settingsCache.invalidate();
				updateStatus(ctx);
				ctx.ui.notify(`Dumb zone starts at ${formatTokenCountForNotice(tokens)} (${settingsPath})`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Failed to save dumb zone setting", "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => updateStatus(ctx));
	pi.on("message_end", (_event, ctx) => updateStatus(ctx));
	pi.on("agent_end", (_event, ctx) => updateStatus(ctx));
	pi.on("session_compact", (_event, ctx) => updateStatus(ctx));
	pi.on("model_select", (_event, ctx) => updateStatus(ctx));
}
