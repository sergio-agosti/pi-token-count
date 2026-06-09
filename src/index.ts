import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	SessionEntry,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
	formatContextPercentDisplay,
	formatContextTokenDisplay,
	formatContextWindowDisplay,
	formatCostDisplay,
	getContextTokenSeverity,
	getDumbZoneStart,
	type ContextTokenSeverity,
} from "./format.ts";
import {
	CompactionSettingsCache,
	setDumbZoneStartTokens,
	type DumbZoneSettingsScope,
} from "./settings.ts";

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function getThinkingLevel(entries: readonly SessionEntry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "thinking_level_change") return entry.thinkingLevel;
	}
	return undefined;
}

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

function joinFooterParts(theme: Theme, parts: readonly string[]): string {
	return parts.filter((part) => part.length > 0).join(theme.fg("dim", " | "));
}

function formatModelReasoningPart(
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	entries: readonly SessionEntry[],
	model: ExtensionContext["model"],
): string {
	if (!model) return theme.fg("dim", "no-model/off");
	const modelName = footerData.getAvailableProviderCount() > 1 ? `(${model.provider}) ${model.id}` : model.id;
	const thinkingLevel = model.reasoning ? getThinkingLevel(entries) || "off" : "off";
	return theme.fg("dim", `${modelName}/${thinkingLevel}`);
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

class TokenCountFooter implements Component {
	constructor(
		private readonly ctx: ExtensionContext,
		private readonly theme: Theme,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly settingsCache: CompactionSettingsCache,
	) {}

	invalidate(): void {
		// Stateless render; no cached ANSI to clear.
	}

	render(width: number): string[] {
		const entries = this.ctx.sessionManager.getEntries();

		let totalCost = 0;

		for (const entry of entries) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const usage = (entry.message as AssistantMessage).usage;
			if (!usage) continue;
			totalCost += usage.cost?.total ?? 0;
		}

		let pwd = formatCwdForFooter(this.ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		const branch = this.footerData.getGitBranch();
		if (branch) pwd = `${pwd} (${branch})`;

		const sessionName = this.ctx.sessionManager.getSessionName();
		if (sessionName) pwd = `${pwd} • ${sessionName}`;

		const model = this.ctx.model;
		const usingSubscription = model ? this.ctx.modelRegistry.isUsingOAuth(model) : false;
		const contextUsage = this.ctx.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
		const contextTokens = contextUsage?.tokens ?? null;
		const compactionSettings = this.settingsCache.get(this.ctx.cwd);
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

		const statsParts = [
			colorContextDisplay(this.theme, contextSeverity, formatContextTokenDisplay(contextTokens)),
			this.theme.fg(
				"dim",
				`${formatContextPercentDisplay(contextTokens, contextWindow)}/${formatContextWindowDisplay(contextWindow)}`,
			),
			this.theme.fg("dim", formatCostDisplay(totalCost, usingSubscription)),
		];
		if (!compactionSettings.enabled) statsParts.push(this.theme.fg("dim", "manual compact"));
		statsParts.push(formatModelReasoningPart(this.theme, this.footerData, entries, model));

		let statsLine = joinFooterParts(this.theme, statsParts);
		if (visibleWidth(statsLine) > width) {
			statsLine = truncateToWidth(statsLine, width, this.theme.fg("dim", "..."));
		}

		const lines = [truncateToWidth(this.theme.fg("dim", pwd), width, this.theme.fg("dim", "...")), statsLine];

		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const statusLine = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text))
				.join(" ");
			lines.push(truncateToWidth(statusLine, width, this.theme.fg("dim", "...")));
		}

		return lines;
	}
}

export default function piTokenCount(pi: ExtensionAPI) {
	const settingsCache = new CompactionSettingsCache();
	let requestFooterRender: (() => void) | undefined;

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
				requestFooterRender?.();
				ctx.ui.notify(`Dumb zone starts at ${formatTokenCountForNotice(tokens)} (${settingsPath})`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Failed to save dumb zone setting", "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubscribeBranchChange = footerData.onBranchChange(() => tui.requestRender());
			let disposed = false;

			return {
				dispose() {
					disposed = true;
					unsubscribeBranchChange();
					requestFooterRender = undefined;
				},
				invalidate() {},
				render(width: number) {
					if (disposed) return [];
					return new TokenCountFooter(ctx, theme, footerData, settingsCache).render(width);
				},
			};
		});
	});

	pi.on("message_end", () => requestFooterRender?.());
	pi.on("agent_end", () => requestFooterRender?.());
	pi.on("session_compact", () => requestFooterRender?.());
	pi.on("model_select", () => requestFooterRender?.());
	pi.on("thinking_level_select", () => requestFooterRender?.());
}
