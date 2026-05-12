import type {
	RoughCutCaption,
	RoughCutEditReason,
	RoughCutEditSegment,
	TranscriptResult,
	TranscriptWord,
} from "./types";

export interface SilenceRange {
	startSeconds: number;
	endSeconds: number;
	durationSeconds: number;
}

export interface SilenceToKeepSegmentsOptions {
	durationSeconds: number;
	silenceRanges: SilenceRange[];
	preSpeechPaddingSeconds?: number;
	postSpeechPaddingSeconds?: number;
	minKeepSegmentSeconds?: number;
	sourceStartSeconds?: number;
	reason?: RoughCutEditReason;
}

const DEFAULT_PRE_SPEECH_PADDING_SECONDS = 0.15;
const DEFAULT_POST_SPEECH_PADDING_SECONDS = 0.25;
const DEFAULT_MIN_KEEP_SEGMENT_SECONDS = 0.4;

const SILENCE_START_PATTERN = /silence_start:\s*([0-9.]+)/g;
const SILENCE_END_PATTERN =
	/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g;

export function parseSilencedetectOutput({
	stderr,
}: {
	stderr: string;
}): SilenceRange[] {
	const events: Array<
		| { type: "start"; seconds: number; index: number }
		| { type: "end"; seconds: number; durationSeconds: number; index: number }
	> = [];

	for (const match of stderr.matchAll(SILENCE_START_PATTERN)) {
		const seconds = Number(match[1]);
		if (Number.isFinite(seconds)) {
			events.push({ type: "start", seconds, index: match.index ?? 0 });
		}
	}
	for (const match of stderr.matchAll(SILENCE_END_PATTERN)) {
		const seconds = Number(match[1]);
		const durationSeconds = Number(match[2]);
		if (Number.isFinite(seconds) && Number.isFinite(durationSeconds)) {
			events.push({
				type: "end",
				seconds,
				durationSeconds,
				index: match.index ?? 0,
			});
		}
	}

	events.sort((a, b) => a.index - b.index);

	const ranges: SilenceRange[] = [];
	let openStart: number | null = null;
	for (const event of events) {
		if (event.type === "start") {
			openStart = event.seconds;
			continue;
		}

		const startSeconds =
			openStart ?? Math.max(0, event.seconds - event.durationSeconds);
		const endSeconds = event.seconds;
		if (endSeconds > startSeconds) {
			ranges.push({
				startSeconds: roundSeconds({ seconds: startSeconds }),
				endSeconds: roundSeconds({ seconds: endSeconds }),
				durationSeconds: roundSeconds({ seconds: endSeconds - startSeconds }),
			});
		}
		openStart = null;
	}

	return ranges;
}

export function silenceRangesToKeepSegments({
	durationSeconds,
	silenceRanges,
	preSpeechPaddingSeconds = DEFAULT_PRE_SPEECH_PADDING_SECONDS,
	postSpeechPaddingSeconds = DEFAULT_POST_SPEECH_PADDING_SECONDS,
	minKeepSegmentSeconds = DEFAULT_MIN_KEEP_SEGMENT_SECONDS,
	sourceStartSeconds = 0,
	reason = "speech",
}: SilenceToKeepSegmentsOptions): RoughCutEditSegment[] {
	if (
		!Number.isFinite(durationSeconds) ||
		durationSeconds <= sourceStartSeconds
	) {
		return [];
	}

	const sortedSilences = silenceRanges
		.map((range) => ({
			startSeconds: clamp({
				value: range.startSeconds,
				min: sourceStartSeconds,
				max: durationSeconds,
			}),
			endSeconds: clamp({
				value: range.endSeconds,
				min: sourceStartSeconds,
				max: durationSeconds,
			}),
		}))
		.filter((range) => range.endSeconds > range.startSeconds)
		.sort((a, b) => a.startSeconds - b.startSeconds);

	const rawKeeps: Array<{ startSeconds: number; endSeconds: number }> = [];
	let cursor = sourceStartSeconds;

	for (const silence of sortedSilences) {
		if (silence.startSeconds > cursor) {
			rawKeeps.push({
				startSeconds: clamp({
					value: cursor - preSpeechPaddingSeconds,
					min: sourceStartSeconds,
					max: durationSeconds,
				}),
				endSeconds: clamp({
					value: silence.startSeconds + postSpeechPaddingSeconds,
					min: sourceStartSeconds,
					max: durationSeconds,
				}),
			});
		}
		cursor = Math.max(cursor, silence.endSeconds);
	}

	if (cursor < durationSeconds) {
		rawKeeps.push({
			startSeconds: clamp({
				value: cursor - preSpeechPaddingSeconds,
				min: sourceStartSeconds,
				max: durationSeconds,
			}),
			endSeconds: durationSeconds,
		});
	}

	return buildTimelineSegments({
		keeps: mergeKeepRanges({
			keeps: rawKeeps,
			minKeepSegmentSeconds,
		}),
		reason,
	});
}

export function remapCaptionsToSegments({
	captions,
	segments,
}: {
	captions: RoughCutCaption[];
	segments: RoughCutEditSegment[];
}): RoughCutCaption[] {
	if (segments.length === 0) {
		return captions;
	}

	const remapped: RoughCutCaption[] = [];
	for (const caption of captions) {
		const captionStart = caption.startTimeSeconds;
		const captionEnd = caption.startTimeSeconds + caption.durationSeconds;

		for (const segment of segments) {
			const overlapStart = Math.max(captionStart, segment.sourceStartSeconds);
			const overlapEnd = Math.min(captionEnd, segment.sourceEndSeconds);
			if (overlapEnd <= overlapStart) {
				continue;
			}

			remapped.push({
				...caption,
				startTimeSeconds: roundSeconds({
					seconds:
						segment.timelineStartSeconds +
						(overlapStart - segment.sourceStartSeconds),
				}),
				durationSeconds: roundSeconds({
					seconds: overlapEnd - overlapStart,
				}),
			});
		}
	}

	return remapped;
}

export function protectSegmentsWithTranscriptWords({
	segments,
	transcript,
	durationSeconds,
	sourceStartSeconds = 0,
	preSpeechPaddingSeconds = DEFAULT_PRE_SPEECH_PADDING_SECONDS,
	postSpeechPaddingSeconds = DEFAULT_POST_SPEECH_PADDING_SECONDS,
	minKeepSegmentSeconds = DEFAULT_MIN_KEEP_SEGMENT_SECONDS,
	reason = "speech",
}: {
	segments: RoughCutEditSegment[];
	transcript: TranscriptResult;
	durationSeconds: number;
	sourceStartSeconds?: number;
	preSpeechPaddingSeconds?: number;
	postSpeechPaddingSeconds?: number;
	minKeepSegmentSeconds?: number;
	reason?: RoughCutEditReason;
}): RoughCutEditSegment[] {
	if (segments.length === 0) {
		return [];
	}

	const firstKeepStartSeconds = segments.reduce(
		(firstStart, segment) =>
			Math.min(firstStart, segment.sourceStartSeconds),
		Number.POSITIVE_INFINITY,
	);
	const keeps = segments.map((segment) => ({
		startSeconds: segment.sourceStartSeconds,
		endSeconds: segment.sourceEndSeconds,
	}));

	for (const word of transcriptWords({ transcript })) {
		if (word.startSeconds >= firstKeepStartSeconds) {
			continue;
		}
		if (word.endSeconds <= sourceStartSeconds || word.startSeconds >= durationSeconds) {
			continue;
		}
		keeps.push({
			startSeconds: clamp({
				value: word.startSeconds - preSpeechPaddingSeconds,
				min: sourceStartSeconds,
				max: durationSeconds,
			}),
			endSeconds: clamp({
				value: word.endSeconds + postSpeechPaddingSeconds,
				min: sourceStartSeconds,
				max: durationSeconds,
			}),
		});
	}

	return buildTimelineSegments({
		keeps: mergeKeepRanges({
			keeps: keeps.sort((a, b) => a.startSeconds - b.startSeconds),
			minKeepSegmentSeconds,
		}),
		reason,
	});
}

function mergeKeepRanges({
	keeps,
	minKeepSegmentSeconds,
}: {
	keeps: Array<{ startSeconds: number; endSeconds: number }>;
	minKeepSegmentSeconds: number;
}): Array<{ startSeconds: number; endSeconds: number }> {
	const merged: Array<{ startSeconds: number; endSeconds: number }> = [];

	for (const keep of keeps) {
		if (keep.endSeconds - keep.startSeconds < minKeepSegmentSeconds) {
			continue;
		}

		const previous = merged.at(-1);
		if (previous && keep.startSeconds <= previous.endSeconds) {
			previous.endSeconds = Math.max(previous.endSeconds, keep.endSeconds);
			continue;
		}

		merged.push({ ...keep });
	}

	return merged;
}

function transcriptWords({
	transcript,
}: {
	transcript: TranscriptResult;
}): TranscriptWord[] {
	return transcript.segments.flatMap((segment) =>
		segment.words && segment.words.length > 0
			? segment.words
			: [
					{
						startSeconds: segment.startSeconds,
						endSeconds: segment.endSeconds,
						text: segment.text,
					},
				],
	);
}

function buildTimelineSegments({
	keeps,
	reason,
}: {
	keeps: Array<{ startSeconds: number; endSeconds: number }>;
	reason: RoughCutEditReason;
}): RoughCutEditSegment[] {
	let timelineCursor = 0;
	return keeps.map((keep) => {
		const duration = keep.endSeconds - keep.startSeconds;
		const segment = {
			sourceStartSeconds: roundSeconds({ seconds: keep.startSeconds }),
			sourceEndSeconds: roundSeconds({ seconds: keep.endSeconds }),
			timelineStartSeconds: roundSeconds({ seconds: timelineCursor }),
			timelineEndSeconds: roundSeconds({ seconds: timelineCursor + duration }),
			reason,
		};
		timelineCursor += duration;
		return segment;
	});
}

function clamp({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}): number {
	return Math.min(max, Math.max(min, value));
}

function roundSeconds({ seconds }: { seconds: number }): number {
	return Math.round(seconds * 1000) / 1000;
}
