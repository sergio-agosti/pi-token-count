import type { ContextTokenSeverity } from "./format.ts";

/**
 * Event-bus channel carrying the context-token reading in structured form.
 *
 * The status line is a rendered string, so a consumer that wants to draw this
 * — a bar with the dumb-zone threshold ticked onto it — would otherwise have
 * to parse the count back out of the text. Publishing the numbers keeps the
 * tick's position and colour tied to the same threshold that coloured the
 * text, rather than re-deriving the dumb zone from settings and drifting from
 * it.
 */
export const CONTEXT_TOKENS_UPDATED_EVENT = "context-tokens:updated";

export interface ContextTokensPayload {
	/**
	 * The status key this feed is the structured form of, so a consumer can
	 * suppress the raw text it supersedes without hardcoding our key.
	 */
	statusKey: string;
	/** Current context tokens, or null before the first reading. */
	tokens: number | null;
	/** Model context window, or 0 when unknown. */
	contextWindow: number;
	/** Token count at which the dumb zone starts, or 0 when not configured. */
	dumbZoneStart: number;
	severity: ContextTokenSeverity;
}

export interface ContextFeedInput {
	statusKey: string;
	tokens: number | null;
	contextWindow: number;
	dumbZoneStart: number;
	severity: ContextTokenSeverity;
}

/**
 * `pi.events.emit` takes `unknown`, so this explicit return type is the only
 * thing pinning the payload shape that consumers mirror.
 */
export function buildContextFeed(input: ContextFeedInput): ContextTokensPayload {
	return {
		statusKey: input.statusKey,
		tokens: input.tokens,
		contextWindow: input.contextWindow,
		dumbZoneStart: input.dumbZoneStart,
		severity: input.severity,
	};
}
