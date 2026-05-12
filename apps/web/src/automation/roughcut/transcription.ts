import type {
	CaptionStylePreset,
	RoughCutCaption,
	RoughCutCaptionStyle,
	RoughCutEditSegment,
	TranscriptResult,
	TranscriptSegment,
	TranscriptWord,
	TranscriptionProviderName,
} from "./types";
import { remapCaptionsToSegments } from "./silence";

export interface TranscriptToCaptionOptions {
	transcript: TranscriptResult;
	stylePreset?: CaptionStylePreset;
	maxWordsPerCaption?: number;
	maxCaptionDurationSeconds?: number;
	protectedPhrases?: string[];
	avoidSingleWordCaptions?: boolean;
}

export interface TranscriptToTimelineCaptionOptions extends TranscriptToCaptionOptions {
	segments?: RoughCutEditSegment[];
	durationSeconds?: number | null;
	trimStartSeconds?: number;
	captionOffsetSeconds?: number;
}

export interface ProviderAvailability {
	whispercpp: boolean;
	whisper: boolean;
}

const DEFAULT_MAX_WORDS_PER_CAPTION = 6;
const DEFAULT_MAX_CAPTION_DURATION_SECONDS = 2.5;
const DEFAULT_AVOID_SINGLE_WORD_CAPTIONS = true;
const SINGLE_WORD_MERGE_DURATION_MULTIPLIER = 2.5;
const DEFAULT_PROTECTED_PHRASES = [
	"botox",
	"canyon ranch",
	"dr. jen wagner",
	"dr. sadio lucio",
	"ice bath",
	"ice baths",
	"midlife women",
	"positive affirmations",
	"protein coffee",
	"rapid fire",
	"strength training",
	"wellness trend",
];

export function transcriptToCaptions({
	transcript,
	stylePreset = "tiktok",
	maxWordsPerCaption = DEFAULT_MAX_WORDS_PER_CAPTION,
	maxCaptionDurationSeconds = DEFAULT_MAX_CAPTION_DURATION_SECONDS,
	protectedPhrases = DEFAULT_PROTECTED_PHRASES,
	avoidSingleWordCaptions = DEFAULT_AVOID_SINGLE_WORD_CAPTIONS,
}: TranscriptToCaptionOptions): RoughCutCaption[] {
	let captions: RoughCutCaption[] = [];
	const style = captionStyleForPreset({ preset: stylePreset });
	const protectedPhraseSet = buildProtectedPhraseSet({ protectedPhrases });

	for (const segment of transcript.segments) {
		const words = mergeProtectedPhrases({
			words: getTimedWords({ segment }),
			protectedPhraseSet,
		});
		let chunk: TranscriptWord[] = [];

		for (const word of words) {
			if (chunk.length > 0 && shouldBreakAtSentenceBoundary({ chunk, word })) {
				captions.push(buildCaptionFromWords({ words: chunk, style }));
				chunk = [word];
				continue;
			}

			const nextChunk = [...chunk, word];
			const chunkDuration =
				nextChunk[nextChunk.length - 1].endSeconds - nextChunk[0].startSeconds;
			if (
				chunk.length > 0 &&
				(countCaptionWords({ words: nextChunk }) > maxWordsPerCaption ||
					chunkDuration > maxCaptionDurationSeconds)
			) {
				captions.push(buildCaptionFromWords({ words: chunk, style }));
				chunk = [word];
				continue;
			}

			chunk = nextChunk;
		}

		if (chunk.length > 0) {
			captions.push(buildCaptionFromWords({ words: chunk, style }));
		}
	}

	if (avoidSingleWordCaptions) {
		captions = mergeSingleWordCaptions({
			captions,
			maxWordsPerCaption,
			maxCaptionDurationSeconds,
		});
	}

	return captions;
}

export function transcriptToTimelineCaptions({
	transcript,
	stylePreset = "tiktok",
	maxWordsPerCaption,
	maxCaptionDurationSeconds,
	segments,
	durationSeconds,
	trimStartSeconds = 2,
	captionOffsetSeconds = 0,
	protectedPhrases,
	avoidSingleWordCaptions,
}: TranscriptToTimelineCaptionOptions): RoughCutCaption[] {
	if (segments && segments.length > 0) {
		return applyCaptionOffset({
			captions: transcriptToCaptions({
				transcript: remapTranscriptToTimeline({ transcript, segments }),
				stylePreset,
				maxWordsPerCaption,
				maxCaptionDurationSeconds,
				protectedPhrases,
				avoidSingleWordCaptions,
			}),
			offsetSeconds: captionOffsetSeconds,
		});
	}

	const captions = transcriptToCaptions({
		transcript,
		stylePreset,
		maxWordsPerCaption,
		maxCaptionDurationSeconds,
		protectedPhrases,
		avoidSingleWordCaptions,
	});
	const transcriptEndSeconds =
		transcript.segments.at(-1)?.endSeconds ?? trimStartSeconds;
	const sourceEndSeconds = Math.max(
		trimStartSeconds,
		durationSeconds ?? transcriptEndSeconds,
	);
	return applyCaptionOffset({
		captions: remapCaptionsToSegments({
			captions,
			segments: [
				{
					sourceStartSeconds: trimStartSeconds,
					sourceEndSeconds,
					timelineStartSeconds: 0,
					timelineEndSeconds: sourceEndSeconds - trimStartSeconds,
					reason: "manual",
				},
			],
		}),
		offsetSeconds: captionOffsetSeconds,
	});
}

function remapTranscriptToTimeline({
	transcript,
	segments,
}: {
	transcript: TranscriptResult;
	segments: RoughCutEditSegment[];
}): TranscriptResult {
	const words = transcript.segments
		.flatMap((segment) => getTimedWords({ segment }))
		.flatMap((word): TranscriptWord[] => {
			const wordStart = word.startSeconds;
			const wordEnd = word.endSeconds;
			for (const segment of segments) {
				const overlapStart = Math.max(wordStart, segment.sourceStartSeconds);
				const overlapEnd = Math.min(wordEnd, segment.sourceEndSeconds);
				if (overlapEnd <= overlapStart) {
					continue;
				}

				return [
					{
						text: word.text,
						startSeconds: roundSeconds({
							seconds:
								segment.timelineStartSeconds +
								(overlapStart - segment.sourceStartSeconds),
						}),
						endSeconds: roundSeconds({
							seconds:
								segment.timelineStartSeconds +
								(overlapEnd - segment.sourceStartSeconds),
						}),
					},
				];
			}
			return [];
		})
		.filter((word) => word.endSeconds - word.startSeconds >= 0.05)
		.sort((a, b) => a.startSeconds - b.startSeconds);

	if (words.length === 0) {
		return { ...transcript, segments: [] };
	}

	return {
		...transcript,
		text: words.map((word) => word.text).join(" "),
		segments: [
			{
				startSeconds: words[0].startSeconds,
				endSeconds: words[words.length - 1].endSeconds,
				text: words.map((word) => word.text).join(" "),
				words,
			},
		],
	};
}

export function captionStyleForPreset({
	preset,
}: {
	preset: CaptionStylePreset;
}): RoughCutCaptionStyle {
	if (preset === "minimal") {
		return {
			fontFamily: "Arial",
			fontSize: 4.5,
			color: "#ffffff",
			fontWeight: "normal",
			textAlign: "center",
			placement: { verticalAlign: "bottom", marginVerticalRatio: 0.06 },
		};
	}

	if (preset === "clean") {
		return {
			fontFamily: "Arial",
			fontSize: 5.5,
			color: "#ffffff",
			fontWeight: "bold",
			textAlign: "center",
			background: {
				enabled: true,
				color: "#000000",
				cornerRadius: 8,
				paddingX: 18,
				paddingY: 12,
			},
			placement: { verticalAlign: "bottom", marginVerticalRatio: 0.07 },
		};
	}

	return {
		fontFamily: "Arial",
		fontSize: 7,
		color: "#ffffff",
		fontWeight: "bold",
		textAlign: "center",
		letterSpacing: 0.2,
		placement: { verticalAlign: "bottom", marginVerticalRatio: 0.08 },
	};
}

export function selectTranscriptionProvider({
	requestedProvider,
	availability,
}: {
	requestedProvider: TranscriptionProviderName;
	availability: ProviderAvailability;
}): Exclude<TranscriptionProviderName, "auto"> {
	if (requestedProvider === "whispercpp") {
		if (!availability.whispercpp) {
			throw new Error(
				"whisper.cpp CLI was not found. Install whisper.cpp and ensure whisper-cli is available on PATH, or set WHISPERCPP_BIN.",
			);
		}
		return "whispercpp";
	}

	if (requestedProvider === "whisper") {
		if (!availability.whisper) {
			throw new Error(
				"OpenAI Whisper Python CLI was not found. Install it with `pip install openai-whisper` and ensure `whisper` is available on PATH.",
			);
		}
		return "whisper";
	}

	if (availability.whispercpp) {
		return "whispercpp";
	}
	if (availability.whisper) {
		return "whisper";
	}

	throw new Error(
		"No supported local transcription CLI found. Install whisper.cpp (`whisper-cli`) or OpenAI Whisper (`pip install openai-whisper`).",
	);
}

export function parseWhisperTranscriptJson({
	input,
}: {
	input: string;
}): TranscriptResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch (error) {
		throw new Error(
			`Could not parse transcription JSON: ${
				error instanceof Error ? error.message : "unknown error"
			}`,
		);
	}

	if (!isRecord(parsed)) {
		throw new Error("Transcription JSON must be an object.");
	}

	const segments = parseTranscriptSegments({ value: parsed.segments }).concat(
		parseWhisperCppSegments({ value: parsed.transcription }),
	);
	const text =
		typeof parsed.text === "string"
			? parsed.text
			: segments.map((segment) => segment.text).join(" ");

	return {
		text: text.trim(),
		segments,
		language: typeof parsed.language === "string" ? parsed.language : undefined,
	};
}

function getTimedWords({
	segment,
}: {
	segment: TranscriptSegment;
}): TranscriptWord[] {
	if (segment.words && segment.words.length > 0) {
		return segment.words
			.filter((word) => word.endSeconds > word.startSeconds && word.text.trim())
			.map((word) => ({ ...word, text: normalizeWord({ text: word.text }) }));
	}

	const words = segment.text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0 || segment.endSeconds <= segment.startSeconds) {
		return [];
	}

	const durationPerWord =
		(segment.endSeconds - segment.startSeconds) / words.length;
	return words.map((word, index) => ({
		text: normalizeWord({ text: word }),
		startSeconds: roundSeconds({
			seconds: segment.startSeconds + durationPerWord * index,
		}),
		endSeconds: roundSeconds({
			seconds: segment.startSeconds + durationPerWord * (index + 1),
		}),
	}));
}

function buildCaptionFromWords({
	words,
	style,
}: {
	words: TranscriptWord[];
	style: RoughCutCaptionStyle;
}): RoughCutCaption {
	const firstWord = words[0];
	const lastWord = words[words.length - 1];
	return {
		text: words.map((word) => word.text).join(" "),
		startTimeSeconds: roundSeconds({ seconds: firstWord.startSeconds }),
		durationSeconds: roundSeconds({
			seconds: lastWord.endSeconds - firstWord.startSeconds,
		}),
		style,
	};
}

function mergeProtectedPhrases({
	words,
	protectedPhraseSet,
}: {
	words: TranscriptWord[];
	protectedPhraseSet: Set<string>;
}): TranscriptWord[] {
	if (protectedPhraseSet.size === 0 || words.length < 2) {
		return words;
	}

	const merged: TranscriptWord[] = [];
	let index = 0;
	while (index < words.length) {
		let bestMatch: TranscriptWord[] | null = null;
		const maxPhraseWords = Math.min(5, words.length - index);
		for (let length = maxPhraseWords; length >= 2; length -= 1) {
			const candidate = words.slice(index, index + length);
			const candidateText = normalizePhrase({
				text: candidate.map((word) => word.text).join(" "),
			});
			if (protectedPhraseSet.has(candidateText)) {
				bestMatch = candidate;
				break;
			}
		}

		if (!bestMatch) {
			merged.push(words[index]);
			index += 1;
			continue;
		}

		merged.push({
			text: bestMatch.map((word) => word.text).join(" "),
			startSeconds: bestMatch[0].startSeconds,
			endSeconds: bestMatch[bestMatch.length - 1].endSeconds,
		});
		index += bestMatch.length;
	}

	return merged;
}

function mergeSingleWordCaptions({
	captions,
	maxWordsPerCaption,
	maxCaptionDurationSeconds,
}: {
	captions: RoughCutCaption[];
	maxWordsPerCaption: number;
	maxCaptionDurationSeconds: number;
}): RoughCutCaption[] {
	const backwardMerged: RoughCutCaption[] = [];

	for (const caption of captions) {
		if (
			!isSingleWordCaption({ caption }) ||
			isAllowedStandaloneCaption({ caption }) ||
			backwardMerged.length === 0
		) {
			backwardMerged.push(caption);
			continue;
		}

		const previous = backwardMerged[backwardMerged.length - 1];
		const candidate = mergeCaptionPair({ first: previous, second: caption });
		if (
			countTextWords({ text: candidate.text }) <= maxWordsPerCaption &&
			candidate.durationSeconds <=
				maxCaptionDurationSeconds * SINGLE_WORD_MERGE_DURATION_MULTIPLIER
		) {
			backwardMerged[backwardMerged.length - 1] = candidate;
			continue;
		}

		backwardMerged.push(caption);
	}

	const forwardMerged: RoughCutCaption[] = [];
	let index = 0;
	while (index < backwardMerged.length) {
		const caption = backwardMerged[index];
		const next = backwardMerged[index + 1];
		if (
			next &&
			isSingleWordCaption({ caption }) &&
			!isAllowedStandaloneCaption({ caption }) &&
			isSingleWordCaption({ caption: next }) &&
			!isAllowedStandaloneCaption({ caption: next })
		) {
			const candidate = mergeCaptionPair({ first: caption, second: next });
			if (
				countTextWords({ text: candidate.text }) <= maxWordsPerCaption &&
				candidate.durationSeconds <=
					maxCaptionDurationSeconds * SINGLE_WORD_MERGE_DURATION_MULTIPLIER
			) {
				forwardMerged.push(candidate);
				index += 2;
				continue;
			}
		}

		forwardMerged.push(caption);
		index += 1;
	}

	return forwardMerged;
}

function mergeCaptionPair({
	first,
	second,
}: {
	first: RoughCutCaption;
	second: RoughCutCaption;
}): RoughCutCaption {
	const endSeconds = Math.max(
		first.startTimeSeconds + first.durationSeconds,
		second.startTimeSeconds + second.durationSeconds,
	);
	return {
		...first,
		text: `${first.text} ${second.text}`.replace(/\s+/g, " ").trim(),
		durationSeconds: roundSeconds({ seconds: endSeconds - first.startTimeSeconds }),
	};
}

function countCaptionWords({ words }: { words: TranscriptWord[] }): number {
	return words.reduce(
		(count, word) => count + countTextWords({ text: word.text }),
		0,
	);
}

function countTextWords({ text }: { text: string }): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function shouldBreakAtSentenceBoundary({
	chunk,
	word,
}: {
	chunk: TranscriptWord[];
	word: TranscriptWord;
}): boolean {
	const previous = chunk[chunk.length - 1];
	if (!previous || isCommonAbbreviation({ text: previous.text })) {
		return false;
	}
	return /[.!?]$/.test(previous.text.trim()) && Boolean(word.text.trim());
}

function isCommonAbbreviation({ text }: { text: string }): boolean {
	return new Set(["dr.", "mr.", "mrs.", "ms."]).has(text.trim().toLowerCase());
}

function isSingleWordCaption({ caption }: { caption: RoughCutCaption }): boolean {
	return countTextWords({ text: caption.text }) === 1;
}

function isAllowedStandaloneCaption({
	caption,
}: {
	caption: RoughCutCaption;
}): boolean {
	const normalized = normalizePhrase({ text: caption.text });
	return new Set(["botox", "sleep", "hey"]).has(normalized);
}

function buildProtectedPhraseSet({
	protectedPhrases,
}: {
	protectedPhrases: string[];
}): Set<string> {
	return new Set(
		protectedPhrases
			.map((phrase) => normalizePhrase({ text: phrase }))
			.filter(Boolean),
	);
}

function normalizePhrase({ text }: { text: string }): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function applyCaptionOffset({
	captions,
	offsetSeconds,
}: {
	captions: RoughCutCaption[];
	offsetSeconds: number;
}): RoughCutCaption[] {
	if (!Number.isFinite(offsetSeconds) || offsetSeconds === 0) {
		return captions;
	}

	return captions.flatMap((caption): RoughCutCaption[] => {
		const start = caption.startTimeSeconds + offsetSeconds;
		const end =
			caption.startTimeSeconds + caption.durationSeconds + offsetSeconds;
		const clampedStart = Math.max(0, start);
		if (end <= clampedStart) {
			return [];
		}

		return [
			{
				...caption,
				startTimeSeconds: roundSeconds({ seconds: clampedStart }),
				durationSeconds: roundSeconds({ seconds: end - clampedStart }),
			},
		];
	});
}

function normalizeWord({ text }: { text: string }): string {
	return text.trim().replace(/\s+/g, " ");
}

function roundSeconds({ seconds }: { seconds: number }): number {
	return Math.round(seconds * 1000) / 1000;
}

function parseTranscriptSegments({
	value,
}: {
	value: unknown;
}): TranscriptSegment[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item): TranscriptSegment[] => {
		if (!isRecord(item)) {
			return [];
		}
		const startSeconds = parseNumber({ value: item.start });
		const endSeconds = parseNumber({ value: item.end });
		const text = typeof item.text === "string" ? item.text.trim() : "";
		if (startSeconds === null || endSeconds === null || !text) {
			return [];
		}

		return [
			{
				startSeconds,
				endSeconds,
				text,
				words: parseWords({ value: item.words }),
			},
		];
	});
}

function parseWhisperCppSegments({
	value,
}: {
	value: unknown;
}): TranscriptSegment[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item): TranscriptSegment[] => {
		if (!isRecord(item)) {
			return [];
		}
		const timestamps = isRecord(item.timestamps) ? item.timestamps : null;
		const offsets = isRecord(item.offsets) ? item.offsets : null;
		const startSeconds =
			parseTimestampSeconds({ value: timestamps?.from }) ??
			parseOffsetSeconds({ value: offsets?.from });
		const endSeconds =
			parseTimestampSeconds({ value: timestamps?.to }) ??
			parseOffsetSeconds({ value: offsets?.to });
		const text = typeof item.text === "string" ? item.text.trim() : "";
		if (startSeconds === null || endSeconds === null || !text) {
			return [];
		}

		return [
			{
				startSeconds,
				endSeconds,
				text,
				words: parseWhisperCppTokenWords({ value: item.tokens }),
			},
		];
	});
}

function parseWords({
	value,
}: {
	value: unknown;
}): TranscriptWord[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const words = value.flatMap((item): TranscriptWord[] => {
		if (!isRecord(item)) {
			return [];
		}
		const startSeconds = parseNumber({ value: item.start });
		const endSeconds = parseNumber({ value: item.end });
		const text =
			typeof item.word === "string"
				? item.word
				: typeof item.text === "string"
					? item.text
					: "";
		if (startSeconds === null || endSeconds === null || !text.trim()) {
			return [];
		}
		return [{ startSeconds, endSeconds, text: text.trim() }];
	});

	return words.length > 0 ? words : undefined;
}

function parseWhisperCppTokenWords({
	value,
}: {
	value: unknown;
}): TranscriptWord[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const words: TranscriptWord[] = [];
	let current: TranscriptWord | null = null;

	for (const item of value) {
		if (!isRecord(item) || typeof item.text !== "string") {
			continue;
		}
		const rawText = item.text;
		const text = rawText.trim();
		if (!text || /^\[.*\]$/.test(text)) {
			continue;
		}

		const timestamps = isRecord(item.timestamps) ? item.timestamps : null;
		const offsets = isRecord(item.offsets) ? item.offsets : null;
		const startSeconds =
			parseTimestampSeconds({ value: timestamps?.from }) ??
			parseOffsetSeconds({ value: offsets?.from });
		const endSeconds =
			parseTimestampSeconds({ value: timestamps?.to }) ??
			parseOffsetSeconds({ value: offsets?.to });
		if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
			continue;
		}

		const startsNewWord = /^\s/.test(rawText) || current === null;
		if (startsNewWord) {
			if (current) {
				words.push(current);
			}
			current = { startSeconds, endSeconds, text };
			continue;
		}

		current = {
			startSeconds: current.startSeconds,
			endSeconds,
			text: `${current.text}${text}`,
		};
	}

	if (current) {
		words.push(current);
	}

	return words.length > 0 ? words : undefined;
}

function parseNumber({ value }: { value: unknown }): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return roundSeconds({ seconds: value });
}

function parseOffsetSeconds({ value }: { value: unknown }): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return roundSeconds({ seconds: value / 1000 });
}

function parseTimestampSeconds({ value }: { value: unknown }): number | null {
	if (typeof value !== "string") {
		return null;
	}

	const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
	if (!match) {
		return null;
	}

	const [, rawHours, rawMinutes, rawSeconds, rawMilliseconds] = match;
	const hours = rawHours ? Number.parseInt(rawHours, 10) : 0;
	const minutes = Number.parseInt(rawMinutes, 10);
	const seconds = Number.parseInt(rawSeconds, 10);
	const milliseconds = Number.parseInt(rawMilliseconds.padEnd(3, "0"), 10);
	return roundSeconds({
		seconds: hours * 3600 + minutes * 60 + seconds + milliseconds / 1000,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
