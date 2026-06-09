import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_DUMB_ZONE_WARNING_RATIO, DEFAULT_RESERVE_TOKENS } from "./format.ts";

const EXTENSION_SETTINGS_KEY = "piTokenCount";

export interface CompactionDisplaySettings {
	enabled: boolean;
	reserveTokens: number;
	dumbZoneStartTokens?: number;
	warningRatio: number;
}

export type DumbZoneSettingsScope = "global" | "project";

interface ExtensionDisplaySettings {
	dumbZoneStartTokens?: number;
	warningRatio: number;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function readJsonObjectForWrite(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
		return parsed as Record<string, unknown>;
	}
	throw new Error(`${path} must contain a JSON object`);
}

function getObjectValue(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
	const value = source?.[key];
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function getPositiveTokenCount(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}

function getWarningRatio(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) return undefined;
	return value;
}

function getSettingsPath(cwd: string, scope: DumbZoneSettingsScope): string {
	return scope === "global" ? join(getAgentDir(), "settings.json") : join(cwd, ".pi", "settings.json");
}

function readExtensionDisplaySettings(cwd: string): ExtensionDisplaySettings {
	const globalSettings = readJsonObject(getSettingsPath(cwd, "global"));
	const projectSettings = readJsonObject(getSettingsPath(cwd, "project"));
	const merged = {
		...getObjectValue(globalSettings, EXTENSION_SETTINGS_KEY),
		...getObjectValue(projectSettings, EXTENSION_SETTINGS_KEY),
	};

	return {
		dumbZoneStartTokens: getPositiveTokenCount(
			merged.dumbZoneStartTokens ?? merged.dumbZoneTokens ?? merged.dumbZoneStart,
		),
		warningRatio:
			getWarningRatio(merged.warningRatio ?? merged.warningThresholdRatio) ?? DEFAULT_DUMB_ZONE_WARNING_RATIO,
	};
}

export function setDumbZoneStartTokens(cwd: string, scope: DumbZoneSettingsScope, tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) {
		throw new Error("Dumb zone token count must be a positive number");
	}

	const settingsPath = getSettingsPath(cwd, scope);
	const settings = readJsonObjectForWrite(settingsPath);
	const existingExtensionSettings = getObjectValue(settings, EXTENSION_SETTINGS_KEY) ?? {};

	settings[EXTENSION_SETTINGS_KEY] = {
		...existingExtensionSettings,
		dumbZoneStartTokens: Math.floor(tokens),
	};

	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	return settingsPath;
}

export class CompactionSettingsCache {
	private cachedAt = 0;
	private cachedCwd: string | undefined;
	private cached: CompactionDisplaySettings = {
		enabled: true,
		reserveTokens: DEFAULT_RESERVE_TOKENS,
		warningRatio: DEFAULT_DUMB_ZONE_WARNING_RATIO,
	};

	constructor(private readonly ttlMs = 1000) {}

	invalidate(): void {
		this.cachedAt = 0;
		this.cachedCwd = undefined;
	}

	get(cwd: string): CompactionDisplaySettings {
		const now = Date.now();
		if (this.cachedCwd === cwd && now - this.cachedAt < this.ttlMs) {
			return this.cached;
		}

		const extensionSettings = readExtensionDisplaySettings(cwd);

		try {
			const settings = SettingsManager.create(cwd).getCompactionSettings();
			this.cached = {
				enabled: settings.enabled,
				reserveTokens:
					Number.isFinite(settings.reserveTokens) && settings.reserveTokens >= 0
						? settings.reserveTokens
						: DEFAULT_RESERVE_TOKENS,
				...extensionSettings,
			};
		} catch {
			// Keep the footer reliable even if settings are temporarily unreadable.
			this.cached = {
				enabled: true,
				reserveTokens: DEFAULT_RESERVE_TOKENS,
				...extensionSettings,
			};
		}

		this.cachedAt = now;
		this.cachedCwd = cwd;
		return this.cached;
	}
}
