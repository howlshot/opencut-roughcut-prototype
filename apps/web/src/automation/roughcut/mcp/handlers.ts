import { access, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { generateRoughCutDocument } from "../generate";
import type { VideoMetadata } from "../media-probe";
import { silenceRangesToKeepSegments, type SilenceRange } from "../silence";
import { transcriptToTimelineCaptions } from "../transcription";
import type {
	RoughCutDocument,
	RoughCutEditSegment,
	TranscriptResult,
	TranscriptionProviderName,
} from "../types";
import {
	detectSilenceRanges,
	probeVideoMetadata,
} from "../../../../scripts/roughcut/ffmpeg";
import { transcribeWithCli } from "../../../../scripts/roughcut/transcription-cli";
import {
	detectSilenceInputSchema,
	explainRoughCutInputSchema,
	generateRoughCutInputSchema,
	probeVideoInputSchema,
	transcribeVideoInputSchema,
} from "./schemas";

export interface RoughCutMcpDependencies {
	fileExists(path: string): Promise<boolean>;
	readTextFile(path: string): Promise<string>;
	writeTextFile(input: { path: string; value: string }): Promise<void>;
	probeVideoMetadata(input: { videoPath: string }): Promise<VideoMetadata>;
	detectSilenceRanges(input: {
		videoPath: string;
		threshold: string;
		minSilenceDurationSeconds: number;
	}): Promise<SilenceRange[]>;
	transcribeWithCli(input: {
		videoPath: string;
		provider: TranscriptionProviderName;
		model?: string | null;
	}): Promise<TranscriptResult>;
}

export interface ProbeVideoOutput extends VideoMetadata {
	suggestedFormat: {
		vertical9x16: boolean;
		needsCrop: boolean;
		notes: string[];
	};
}

export interface DetectSilenceOutput {
	silenceRanges: SilenceRange[];
	suggestedKeepSegments: RoughCutEditSegment[];
}

export interface TranscribeVideoOutput {
	transcriptSegments: TranscriptResult["segments"];
	transcriptOut?: string;
	providerUsed: string;
}

export interface GenerateRoughCutOutput {
	roughcutOut: string;
	transcriptOut?: string;
	summary: {
		clipCount: number;
		captionCount: number;
		originalDuration: number | null;
		editedDuration: number;
		removedDuration: number | null;
	};
}

export interface ExplainRoughCutOutput {
	summary: string;
	warnings: string[];
}

export function createDefaultRoughCutMcpDependencies(): RoughCutMcpDependencies {
	return {
		fileExists: async (path) => {
			try {
				await access(path);
				return true;
			} catch {
				return false;
			}
		},
		readTextFile: (path) => readFile(path, "utf8"),
		writeTextFile: ({ path, value }) => writeFile(path, value, "utf8"),
		probeVideoMetadata,
		detectSilenceRanges,
		transcribeWithCli,
	};
}

export function createRoughCutMcpHandlers(
	dependencies: RoughCutMcpDependencies = createDefaultRoughCutMcpDependencies(),
) {
	return {
		probeVideo: (input: unknown) => probeVideo({ input, dependencies }),
		detectSilence: (input: unknown) => detectSilence({ input, dependencies }),
		transcribeVideo: (input: unknown) =>
			transcribeVideo({ input, dependencies }),
		generateRoughCut: (input: unknown) =>
			generateRoughCut({ input, dependencies }),
		explainRoughCut: (input: unknown) =>
			explainRoughCut({ input, dependencies }),
	};
}

async function probeVideo({
	input,
	dependencies,
}: {
	input: unknown;
	dependencies: RoughCutMcpDependencies;
}): Promise<ProbeVideoOutput> {
	const { videoPath } = probeVideoInputSchema.parse(input);
	await assertFileExists({
		path: videoPath,
		dependencies,
		label: "Video file",
	});
	const metadata = await dependencies.probeVideoMetadata({ videoPath });

	return {
		...metadata,
		suggestedFormat: suggestFormat({ metadata }),
	};
}

async function detectSilence({
	input,
	dependencies,
}: {
	input: unknown;
	dependencies: RoughCutMcpDependencies;
}): Promise<DetectSilenceOutput> {
	const { videoPath, silenceThreshold, minSilenceDuration } =
		detectSilenceInputSchema.parse(input);
	await assertFileExists({
		path: videoPath,
		dependencies,
		label: "Video file",
	});
	const [metadata, silenceRanges] = await Promise.all([
		dependencies.probeVideoMetadata({ videoPath }),
		dependencies.detectSilenceRanges({
			videoPath,
			threshold: silenceThreshold,
			minSilenceDurationSeconds: minSilenceDuration,
		}),
	]);

	return {
		silenceRanges,
		suggestedKeepSegments:
			metadata.durationSeconds == null
				? []
				: silenceRangesToKeepSegments({
						durationSeconds: metadata.durationSeconds,
						silenceRanges,
					}),
	};
}

async function transcribeVideo({
	input,
	dependencies,
}: {
	input: unknown;
	dependencies: RoughCutMcpDependencies;
}): Promise<TranscribeVideoOutput> {
	const { videoPath, provider, model, transcriptOut } =
		transcribeVideoInputSchema.parse(input);
	await assertFileExists({
		path: videoPath,
		dependencies,
		label: "Video file",
	});
	const transcript = await dependencies.transcribeWithCli({
		videoPath,
		provider,
		model,
	});

	if (transcriptOut) {
		await dependencies.writeTextFile({
			path: transcriptOut,
			value: `${JSON.stringify(transcript, null, 2)}\n`,
		});
	}

	return {
		transcriptSegments: transcript.segments,
		transcriptOut,
		providerUsed: transcript.provider ?? provider,
	};
}

async function generateRoughCut({
	input,
	dependencies,
}: {
	input: unknown;
	dependencies: RoughCutMcpDependencies;
}): Promise<GenerateRoughCutOutput> {
	const options = generateRoughCutInputSchema.parse(input);
	await assertFileExists({
		path: options.videoPath,
		dependencies,
		label: "Video file",
	});

	const metadata =
		options.autoSilenceCut || options.durationSeconds == null
			? await dependencies.probeVideoMetadata({ videoPath: options.videoPath })
			: null;
	const durationSeconds = options.durationSeconds ?? metadata?.durationSeconds;
	const silenceRanges =
		options.autoSilenceCut && metadata?.hasAudio
			? await dependencies.detectSilenceRanges({
					videoPath: options.videoPath,
					threshold: options.silenceThreshold,
					minSilenceDurationSeconds: options.minSilenceDuration,
				})
			: [];
	const segments =
		options.autoSilenceCut && durationSeconds != null
			? silenceRangesToKeepSegments({
					durationSeconds,
					silenceRanges,
					sourceStartSeconds: 2,
				})
			: undefined;
	const transcript = options.autoTranscribe
		? await dependencies.transcribeWithCli({
				videoPath: options.videoPath,
				provider: options.transcriptionProvider,
				model: options.transcriptionModel,
			})
		: null;
	const transcriptOut = transcript
		? buildTranscriptOutputPath({ roughcutOut: options.roughcutOut })
		: undefined;
	const captions = transcript
		? transcriptToTimelineCaptions({
				transcript,
				stylePreset: options.captionStyle,
				segments,
				durationSeconds,
				trimStartSeconds: 2,
			})
		: undefined;

	if (transcript && transcriptOut) {
		await dependencies.writeTextFile({
			path: transcriptOut,
			value: `${JSON.stringify(transcript, null, 2)}\n`,
		});
	}

	const document = generateRoughCutDocument({
		videoPath: options.videoPath,
		projectName: "TikTok rough cut",
		durationSeconds,
		sourceWidth: metadata?.width,
		sourceHeight: metadata?.height,
		fps: metadata?.fps,
		segments,
		hasAudio: metadata?.hasAudio,
		captions,
		prompt: options.promptNotes,
	});
	await dependencies.writeTextFile({
		path: options.roughcutOut,
		value: `${JSON.stringify(document, null, 2)}\n`,
	});

	return {
		roughcutOut: options.roughcutOut,
		transcriptOut,
		summary: summarizeRoughCut({ document }),
	};
}

async function explainRoughCut({
	input,
	dependencies,
}: {
	input: unknown;
	dependencies: RoughCutMcpDependencies;
}): Promise<ExplainRoughCutOutput> {
	const { roughcutJsonPath } = explainRoughCutInputSchema.parse(input);
	await assertFileExists({
		path: roughcutJsonPath,
		dependencies,
		label: "Rough-cut JSON file",
	});
	const roughCut = parseRoughCutJson({
		input: await dependencies.readTextFile(roughcutJsonPath),
	});
	return explainDocument({ roughCut });
}

function suggestFormat({ metadata }: { metadata: VideoMetadata }) {
	const notes: string[] = [];
	const vertical9x16 =
		metadata.width != null &&
		metadata.height != null &&
		Math.abs(metadata.width / metadata.height - 9 / 16) <= 0.02;
	const needsCrop =
		metadata.width != null && metadata.height != null && !vertical9x16;

	if (metadata.width == null || metadata.height == null) {
		notes.push("Video dimensions were not available from ffprobe.");
	} else if (vertical9x16) {
		notes.push("Source is already close to vertical 9:16.");
	} else if (metadata.width > metadata.height) {
		notes.push(
			"Source is landscape; generate a vertical rough cut and crop/pan manually in OpenCut.",
		);
	} else {
		notes.push(
			"Source is vertical but not exactly 9:16; verify framing in OpenCut.",
		);
	}
	if (!metadata.hasAudio) {
		notes.push(
			"No audio stream was detected; silence detection and transcription may not be useful.",
		);
	}

	return { vertical9x16, needsCrop, notes };
}

function summarizeRoughCut({
	document,
}: {
	document: RoughCutDocument;
}): GenerateRoughCutOutput["summary"] {
	const editedDuration = document.clips.reduce(
		(maxEnd, clip) =>
			Math.max(maxEnd, clip.timelineStartSeconds + clip.durationSeconds),
		0,
	);
	const originalDuration = document.media[0]?.durationSeconds ?? null;
	return {
		clipCount: document.clips.length,
		captionCount: document.captions.length,
		originalDuration,
		editedDuration: roundSeconds({ seconds: editedDuration }),
		removedDuration:
			originalDuration == null
				? null
				: roundSeconds({
						seconds: Math.max(0, originalDuration - editedDuration),
					}),
	};
}

function explainDocument({
	roughCut,
}: {
	roughCut: RoughCutDocument;
}): ExplainRoughCutOutput {
	const warnings: string[] = [];
	if (roughCut.schema !== "opencut-roughcut-v1") {
		warnings.push(`Unexpected schema: ${String(roughCut.schema)}`);
	}
	if (roughCut.clips.length === 0) {
		warnings.push("No timeline clips are present.");
	}
	if (roughCut.captions.length === 0) {
		warnings.push("No caption elements are present.");
	}
	if (!roughCut.editDecisionList && !roughCut.segments) {
		warnings.push(
			"No edit decision list is present; this may be a simple one-clip rough cut.",
		);
	}

	const editedDuration = summarizeRoughCut({
		document: roughCut,
	}).editedDuration;
	const settings = roughCut.project;
	const clipLines = roughCut.clips.map(
		(clip) =>
			`- ${clip.id}: source ${formatSeconds(clip.sourceStartSeconds)} to ${formatSeconds(
				clip.sourceStartSeconds + clip.durationSeconds,
			)} -> timeline ${formatSeconds(clip.timelineStartSeconds)} to ${formatSeconds(
				clip.timelineStartSeconds + clip.durationSeconds,
			)}`,
	);
	const captionPreview = roughCut.captions
		.slice(0, 5)
		.map(
			(caption) =>
				`- ${formatSeconds(caption.startTimeSeconds)} for ${formatSeconds(
					caption.durationSeconds,
				)}: ${caption.text}`,
		);
	const segmentLines = (
		roughCut.editDecisionList?.segments ??
		roughCut.segments ??
		[]
	)
		.slice(0, 8)
		.map(
			(segment) =>
				`- ${segment.reason}: keep source ${formatSeconds(
					segment.sourceStartSeconds,
				)} to ${formatSeconds(segment.sourceEndSeconds)} at timeline ${formatSeconds(
					segment.timelineStartSeconds,
				)} to ${formatSeconds(segment.timelineEndSeconds)}`,
		);

	return {
		summary: [
			`Project: ${settings.name}`,
			`Canvas: ${settings.canvasSize.width}x${settings.canvasSize.height}, FPS: ${settings.fps.numerator}/${settings.fps.denominator}`,
			`Media: ${roughCut.media.length} item(s), Clips: ${roughCut.clips.length}, Captions: ${roughCut.captions.length}`,
			`Edited duration: ${formatSeconds(editedDuration)}`,
			"",
			"Clips:",
			clipLines.length > 0 ? clipLines.join("\n") : "- None",
			"",
			"Captions:",
			captionPreview.length > 0 ? captionPreview.join("\n") : "- None",
			roughCut.captions.length > captionPreview.length
				? `- ...${roughCut.captions.length - captionPreview.length} more caption(s)`
				: "",
			"",
			"Edit decision list:",
			segmentLines.length > 0 ? segmentLines.join("\n") : "- None",
			"",
			"Limitations:",
			"- This is an intermediate rough-cut JSON, not native OpenCut project JSON.",
			"- Import still needs the browser-side OpenCut importer to attach media files.",
		]
			.filter((line) => line !== "")
			.join("\n"),
		warnings,
	};
}

function parseRoughCutJson({ input }: { input: string }): RoughCutDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch (error) {
		throw new Error(
			`Invalid rough-cut JSON: ${
				error instanceof Error ? error.message : "unknown parse error"
			}`,
		);
	}
	if (!isRoughCutDocument(parsed)) {
		throw new Error(
			"Invalid rough-cut JSON: expected an object with project, media, clips, and captions fields.",
		);
	}
	return parsed;
}

function isRoughCutDocument(value: unknown): value is RoughCutDocument {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.schema === "string" &&
		typeof value.project === "object" &&
		Array.isArray(value.media) &&
		Array.isArray(value.clips) &&
		Array.isArray(value.captions)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertFileExists({
	path,
	dependencies,
	label,
}: {
	path: string;
	dependencies: RoughCutMcpDependencies;
	label: string;
}) {
	if (!(await dependencies.fileExists(path))) {
		throw new Error(`${label} does not exist: ${path}`);
	}
}

function buildTranscriptOutputPath({ roughcutOut }: { roughcutOut: string }) {
	return extname(roughcutOut).toLowerCase() === ".json"
		? roughcutOut.replace(/\.json$/i, ".transcript.json")
		: `${roughcutOut}.transcript.json`;
}

function formatSeconds(seconds: number) {
	return `${roundSeconds({ seconds })}s`;
}

function roundSeconds({ seconds }: { seconds: number }) {
	return Math.round(seconds * 1000) / 1000;
}
