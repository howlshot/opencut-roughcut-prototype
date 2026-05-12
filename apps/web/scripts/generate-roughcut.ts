import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateRoughCutDocument } from "../src/automation/roughcut/generate";
import {
	protectSegmentsWithTranscriptWords,
	silenceRangesToKeepSegments,
} from "../src/automation/roughcut/silence";
import { transcriptToTimelineCaptions } from "../src/automation/roughcut/transcription";
import type {
	CaptionStylePreset,
	TranscriptResult,
	TranscriptionProviderName,
} from "../src/automation/roughcut/types";
import { detectSilenceRanges, probeVideoMetadata } from "./roughcut/ffmpeg";
import { transcribeWithCli } from "./roughcut/transcription-cli";

interface CliOptions {
	videoPath: string | null;
	roughcutOutputPath: string | null;
	transcriptOutputPath: string | null;
	projectName: string;
	subtitlePath: string | null;
	durationSeconds: number | null;
	trimStartSeconds: number;
	width: number | null;
	height: number | null;
	fps: number | null;
	autoSilenceCut: boolean;
	silenceThreshold: string;
	minSilenceDurationSeconds: number;
	preSpeechPaddingSeconds: number;
	postSpeechPaddingSeconds: number;
	minKeepSegmentSeconds: number;
	autoTranscribe: boolean;
	transcriptionProvider: TranscriptionProviderName;
	transcriptionModel: string | null;
	transcriptionPrompt: string | null;
	captionsFromTranscript: boolean;
	captionStyle: CaptionStylePreset;
	maxWordsPerCaption: number;
	maxCaptionDurationSeconds: number;
	captionOffsetSeconds: number;
	protectedPhrases: string[] | undefined;
	avoidSingleWordCaptions: boolean;
}

const DEFAULT_OUTPUT_PATH = "opencut-roughcut-v1.json";

async function main() {
	const options = parseArgs({ args: process.argv.slice(2) });
	if (!options.videoPath) {
		printUsage();
		process.exitCode = 1;
		return;
	}
	if (options.transcriptOutputPath && !options.autoTranscribe) {
		throw new Error("--transcript-out requires --auto-transcribe.");
	}

	const subtitleInput = options.subtitlePath
		? await readFile(options.subtitlePath, "utf8")
		: null;
	const metadata = options.autoSilenceCut
		? await probeVideoMetadata({ videoPath: options.videoPath })
		: null;
	const durationSeconds = options.durationSeconds ?? metadata?.durationSeconds;
	const silenceRanges =
		options.autoSilenceCut && metadata?.hasAudio
			? await detectSilenceRanges({
					videoPath: options.videoPath,
					threshold: options.silenceThreshold,
					minSilenceDurationSeconds: options.minSilenceDurationSeconds,
				})
			: [];
	let segments =
		options.autoSilenceCut && durationSeconds != null
			? silenceRangesToKeepSegments({
					durationSeconds,
					silenceRanges,
					sourceStartSeconds: options.trimStartSeconds,
					preSpeechPaddingSeconds: options.preSpeechPaddingSeconds,
					postSpeechPaddingSeconds: options.postSpeechPaddingSeconds,
					minKeepSegmentSeconds: options.minKeepSegmentSeconds,
				})
			: undefined;
	const transcript = options.autoTranscribe
		? await transcribeWithCli({
				videoPath: options.videoPath,
				provider: options.transcriptionProvider,
				model: options.transcriptionModel,
				prompt: options.transcriptionPrompt,
			})
		: null;
	if (transcript && segments && durationSeconds != null) {
		segments = protectSegmentsWithTranscriptWords({
			segments,
			transcript,
			durationSeconds,
			sourceStartSeconds: options.trimStartSeconds,
			preSpeechPaddingSeconds: options.preSpeechPaddingSeconds,
			postSpeechPaddingSeconds: options.postSpeechPaddingSeconds,
			minKeepSegmentSeconds: options.minKeepSegmentSeconds,
		});
	}
	const captions =
		transcript && (options.captionsFromTranscript || !options.subtitlePath)
			? transcriptToTimelineCaptions({
					transcript,
					stylePreset: options.captionStyle,
					segments,
					durationSeconds,
					trimStartSeconds: options.trimStartSeconds,
					maxWordsPerCaption: options.maxWordsPerCaption,
					maxCaptionDurationSeconds: options.maxCaptionDurationSeconds,
					captionOffsetSeconds: options.captionOffsetSeconds,
					protectedPhrases: options.protectedPhrases,
					avoidSingleWordCaptions: options.avoidSingleWordCaptions,
				})
			: undefined;

	if (options.transcriptOutputPath && transcript) {
		await writeJsonFile({
			path: options.transcriptOutputPath,
			value: transcript,
		});
		console.log(`Wrote ${resolve(options.transcriptOutputPath)}`);
	}

	const roughcutOutputPath =
		options.roughcutOutputPath ??
		(options.transcriptOutputPath ? null : DEFAULT_OUTPUT_PATH);
	if (!roughcutOutputPath) {
		return;
	}

	const document = generateRoughCutDocument({
		videoPath: options.videoPath,
		projectName: options.projectName,
		subtitleInput,
		subtitleFileName: options.subtitlePath,
		durationSeconds,
		sourceWidth: options.width ?? metadata?.width,
		sourceHeight: options.height ?? metadata?.height,
		fps: options.fps ?? metadata?.fps,
		trimStartSeconds: options.trimStartSeconds,
		segments,
		hasAudio: metadata?.hasAudio,
		captions,
	});

	await writeJsonFile({ path: roughcutOutputPath, value: document });

	console.log(`Wrote ${resolve(roughcutOutputPath)}`);
}

export function parseArgs({ args }: { args: string[] }): CliOptions {
	const options: CliOptions = {
		videoPath: null,
		roughcutOutputPath: null,
		transcriptOutputPath: null,
		projectName: "TikTok rough cut",
		subtitlePath: null,
		durationSeconds: null,
		trimStartSeconds: 2,
		width: null,
		height: null,
		fps: null,
		autoSilenceCut: false,
		silenceThreshold: "-35dB",
		minSilenceDurationSeconds: 0.35,
		preSpeechPaddingSeconds: 0.15,
		postSpeechPaddingSeconds: 0.25,
		minKeepSegmentSeconds: 0.4,
		autoTranscribe: false,
		transcriptionProvider: "auto",
		transcriptionModel: null,
		transcriptionPrompt: null,
		captionsFromTranscript: false,
		captionStyle: "tiktok",
		maxWordsPerCaption: 4,
		maxCaptionDurationSeconds: 1.2,
		captionOffsetSeconds: -0.22,
		protectedPhrases: undefined,
		avoidSingleWordCaptions: true,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const value = args[index + 1];

		switch (arg) {
			case "--video":
				options.videoPath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--out":
			case "--roughcut-out":
				options.roughcutOutputPath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--transcript-out":
				options.transcriptOutputPath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--project-name":
				options.projectName = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--subtitles":
			case "--srt":
			case "--vtt":
				options.subtitlePath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--duration-seconds":
				options.durationSeconds = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--trim-start-seconds":
				options.trimStartSeconds = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--width":
				options.width = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--height":
				options.height = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--fps":
				options.fps = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--auto-silence-cut":
				options.autoSilenceCut = true;
				break;
			case "--silence-threshold":
				options.silenceThreshold = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--min-silence-duration":
				options.minSilenceDurationSeconds = parseNumberArg({
					flag: arg,
					value,
				});
				index += 1;
				break;
			case "--pre-speech-padding":
				options.preSpeechPaddingSeconds = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--post-speech-padding":
				options.postSpeechPaddingSeconds = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--min-keep-segment":
				options.minKeepSegmentSeconds = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--auto-transcribe":
				options.autoTranscribe = true;
				break;
			case "--transcription-provider":
				options.transcriptionProvider = parseProviderArg({
					flag: arg,
					value,
				});
				index += 1;
				break;
			case "--transcription-model":
				options.transcriptionModel = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--transcription-prompt":
				options.transcriptionPrompt = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--captions-from-transcript":
				options.captionsFromTranscript = true;
				break;
			case "--caption-style":
				options.captionStyle = parseCaptionStyleArg({ flag: arg, value });
				index += 1;
				break;
			case "--max-words-per-caption":
				options.maxWordsPerCaption = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--max-caption-duration":
				options.maxCaptionDurationSeconds = parseNumberArg({
					flag: arg,
					value,
				});
				index += 1;
				break;
			case "--caption-offset-seconds":
				options.captionOffsetSeconds = parseSignedNumberArg({
					flag: arg,
					value,
				});
				index += 1;
				break;
			case "--protected-phrase":
				options.protectedPhrases = [
					...(options.protectedPhrases ?? []),
					requireValue({ flag: arg, value }),
				];
				index += 1;
				break;
			case "--allow-single-word-captions":
				options.avoidSingleWordCaptions = false;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function requireValue({
	flag,
	value,
}: {
	flag: string;
	value: string | undefined;
}): string {
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function parseNumberArg({
	flag,
	value,
}: {
	flag: string;
	value: string | undefined;
}): number {
	const parsed = Number(requireValue({ flag, value }));
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative finite number.`);
	}
	return parsed;
}

function parseSignedNumberArg({
	flag,
	value,
}: {
	flag: string;
	value: string | undefined;
}): number {
	const parsed = Number(requireValue({ flag, value }));
	if (!Number.isFinite(parsed)) {
		throw new Error(`${flag} must be a finite number.`);
	}
	return parsed;
}

function parseProviderArg({
	flag,
	value,
}: {
	flag: string;
	value: string | undefined;
}): TranscriptionProviderName {
	const provider = requireValue({ flag, value });
	if (
		provider === "whispercpp" ||
		provider === "whisper" ||
		provider === "auto"
	) {
		return provider;
	}
	throw new Error(`${flag} must be one of: whispercpp, whisper, auto.`);
}

function parseCaptionStyleArg({
	flag,
	value,
}: {
	flag: string;
	value: string | undefined;
}): CaptionStylePreset {
	const style = requireValue({ flag, value });
	if (style === "tiktok" || style === "clean" || style === "minimal") {
		return style;
	}
	throw new Error(`${flag} must be one of: tiktok, clean, minimal.`);
}

async function writeJsonFile({
	path,
	value,
}: {
	path: string;
	value: TranscriptResult | ReturnType<typeof generateRoughCutDocument>;
}) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printUsage() {
	console.log(`Usage:
  bun apps/web/scripts/generate-roughcut.ts --video input.mp4 [options]

Options:
  --out path                  Rough-cut JSON path alias. Default: ${DEFAULT_OUTPUT_PATH}
  --roughcut-out path         Rough-cut JSON output path
  --transcript-out path       Transcript JSON output path. Requires --auto-transcribe
  --project-name name         Project name. Default: TikTok rough cut
  --subtitles path            Optional .srt or .vtt captions
  --duration-seconds number   Optional source duration metadata
  --trim-start-seconds number Leading trim. Default: 2
  --width number              Optional source width metadata
  --height number             Optional source height metadata
  --fps number                Optional source FPS metadata
  --auto-silence-cut          Probe media and build clips from speech ranges
  --silence-threshold value   FFmpeg silencedetect threshold. Default: -35dB
  --min-silence-duration n    Minimum silence duration. Default: 0.35
  --pre-speech-padding n      Keep audio before speech starts. Default: 0.15
  --post-speech-padding n     Keep audio after speech ends. Default: 0.25
  --min-keep-segment n        Drop shorter speech segments. Default: 0.4
  --auto-transcribe           Generate a transcript with a local Whisper CLI
  --transcription-provider p  whispercpp, whisper, or auto. Default: auto
  --transcription-model value whisper.cpp model path or Whisper model name
  --transcription-prompt text Vocabulary/context hint for local Whisper
  --captions-from-transcript  Prefer generated transcript captions over subtitle input
  --caption-style style       tiktok, clean, or minimal. Default: tiktok
  --max-words-per-caption n   Max words per generated caption. Default: 4
  --max-caption-duration n    Max generated caption duration. Default: 1.2
  --caption-offset-seconds n  Shift captions earlier/later. Default: -0.22
  --protected-phrase text     Keep phrase words together. Can be repeated.
  --allow-single-word-captions Disable automatic merge of one-word captions
`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
