import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { NextRequest } from "next/server";
import { generateRoughCutDocument } from "@/automation/roughcut/generate";
import {
	protectSegmentsWithTranscriptWords,
	silenceRangesToKeepSegments,
} from "@/automation/roughcut/silence";
import { transcriptToTimelineCaptions } from "@/automation/roughcut/transcription";
import { detectSilenceRanges, probeVideoMetadata } from "../../../../../scripts/roughcut/ffmpeg";
import { roughCutCaptionsToSrt } from "../../../../../scripts/roughcut/export-srt";
import { renderRoughCutWithFfmpeg } from "../../../../../scripts/roughcut/render-ffmpeg";
import { transcribeWithCli } from "../../../../../scripts/roughcut/transcription-cli";
import type { CaptionStylePreset } from "@/automation/roughcut/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SMALL_MODEL = "/Users/david/.cache/whisper.cpp/ggml-small.en.bin";
const DEFAULT_BASE_MODEL = "/Users/david/.cache/whisper.cpp/ggml-base.en.bin";
const DEFAULT_TRANSCRIPTION_PROMPT =
	"Canyon Ranch, Dr. Jen Wagner, Dr. Sadio Lucio, wellness, Botox, ice baths, morning routine, stretching, protein coffee, mindset, positive affirmations, sleep, midlife women, strength training.";

export async function POST(request: NextRequest) {
	if (process.env.NODE_ENV !== "development") {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	try {
		const contentType = request.headers.get("content-type") ?? "";
		if (
			!contentType.includes("multipart/form-data") &&
			!contentType.includes("application/x-www-form-urlencoded")
		) {
			return Response.json({ error: "Upload a video file." }, { status: 400 });
		}

		const formData = await request.formData();
		const video = formData.get("video");
		if (!(video instanceof File)) {
			return Response.json({ error: "Choose a video file." }, { status: 400 });
		}

		const options = parseOptions({ formData });
		const modelPath = await resolveModelPath({
			requestedModelPath: options.modelPath,
		});
		const outputDir = join(
			"/Users/david/Downloads/roughcut-gui",
			`${safeBaseName({ name: video.name })}-${Date.now()}`,
		);
		await mkdir(outputDir, { recursive: true });

		const inputPath = join(outputDir, `source${extname(video.name) || ".mp4"}`);
		await writeFile(inputPath, Buffer.from(await video.arrayBuffer()));

		const metadata = await probeVideoMetadata({ videoPath: inputPath });
		const silenceRanges =
			options.autoSilenceCut && metadata.hasAudio
				? await detectSilenceRanges({
						videoPath: inputPath,
						threshold: options.silenceThreshold,
						minSilenceDurationSeconds: options.minSilenceDurationSeconds,
					})
				: [];
		let segments = options.autoSilenceCut
			? silenceRangesToKeepSegments({
					durationSeconds: metadata.durationSeconds,
					silenceRanges,
					sourceStartSeconds: options.trimStartSeconds,
					preSpeechPaddingSeconds: options.preSpeechPaddingSeconds,
					postSpeechPaddingSeconds: options.postSpeechPaddingSeconds,
					minKeepSegmentSeconds: options.minKeepSegmentSeconds,
				})
			: undefined;
		const transcript = options.autoTranscribe
			? await transcribeWithCli({
					videoPath: inputPath,
					provider: "whispercpp",
					model: modelPath,
					prompt: options.transcriptionPrompt,
				})
			: null;
		if (transcript && segments && segments.length > 0) {
			segments = protectSegmentsWithTranscriptWords({
				segments,
				transcript,
				durationSeconds: metadata.durationSeconds,
				sourceStartSeconds: options.trimStartSeconds,
				preSpeechPaddingSeconds: options.preSpeechPaddingSeconds,
				postSpeechPaddingSeconds: options.postSpeechPaddingSeconds,
				minKeepSegmentSeconds: options.minKeepSegmentSeconds,
			});
		}
		const captions = transcript
			? transcriptToTimelineCaptions({
					transcript,
					stylePreset: options.captionStyle,
					segments,
					durationSeconds: metadata.durationSeconds,
					trimStartSeconds: options.trimStartSeconds,
					maxWordsPerCaption: options.maxWordsPerCaption,
					maxCaptionDurationSeconds: options.maxCaptionDurationSeconds,
					captionOffsetSeconds: options.captionOffsetSeconds,
				})
			: undefined;

		const roughCut = generateRoughCutDocument({
			videoPath: inputPath,
			projectName: options.projectName,
			durationSeconds: metadata.durationSeconds,
			sourceWidth: metadata.width,
			sourceHeight: metadata.height,
			fps: metadata.fps,
			trimStartSeconds: options.trimStartSeconds,
			segments,
			hasAudio: metadata.hasAudio,
			captions,
		});

		const roughcutPath = join(outputDir, "roughcut.json");
		const transcriptPath = transcript ? join(outputDir, "transcript.json") : null;
		const srtPath = join(outputDir, "captions.srt");
		const cleanVideoPath = join(outputDir, "capcut-clean.mp4");
		const previewVideoPath = options.renderPreview
			? join(outputDir, "preview-burned-captions.mp4")
			: null;

		await writeFile(roughcutPath, `${JSON.stringify(roughCut, null, 2)}\n`, "utf8");
		if (transcript && transcriptPath) {
			await writeFile(
				transcriptPath,
				`${JSON.stringify(transcript, null, 2)}\n`,
				"utf8",
			);
		}
		await writeFile(srtPath, roughCutCaptionsToSrt({ roughCut }), "utf8");
		await renderRoughCutWithFfmpeg({
			roughCut,
			videoPath: inputPath,
			outputPath: cleanVideoPath,
			burnCaptions: false,
		});
		if (previewVideoPath) {
			await renderRoughCutWithFfmpeg({
				roughCut,
				videoPath: inputPath,
				outputPath: previewVideoPath,
				burnCaptions: true,
			});
		}

		return Response.json({
			outputDir,
			summary: {
				clipCount: roughCut.clips.length,
				captionCount: roughCut.captions.length,
				originalDuration: metadata.durationSeconds,
				editedDuration: roughCut.clips.reduce(
					(total, clip) => total + clip.durationSeconds,
					0,
				),
				removedDuration:
					metadata.durationSeconds -
					roughCut.clips.reduce((total, clip) => total + clip.durationSeconds, 0),
			},
			files: {
				cleanVideo: fileResult({ path: cleanVideoPath }),
				captions: fileResult({ path: srtPath }),
				roughcut: fileResult({ path: roughcutPath }),
				transcript: transcriptPath ? fileResult({ path: transcriptPath }) : null,
				previewVideo: previewVideoPath
					? fileResult({ path: previewVideoPath })
					: null,
			},
		});
	} catch (error) {
		return Response.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to generate rough cut.",
			},
			{ status: 500 },
		);
	}
}

function parseOptions({ formData }: { formData: FormData }) {
	return {
		projectName: stringValue({ formData, key: "projectName" }) || "TikTok rough cut",
		autoSilenceCut: booleanValue({ formData, key: "autoSilenceCut", fallback: true }),
		autoTranscribe: booleanValue({ formData, key: "autoTranscribe", fallback: true }),
		renderPreview: booleanValue({ formData, key: "renderPreview", fallback: true }),
		modelPath: stringValue({ formData, key: "modelPath" }),
		transcriptionPrompt:
			stringValue({ formData, key: "transcriptionPrompt" }) ||
			DEFAULT_TRANSCRIPTION_PROMPT,
		captionStyle: captionStyleValue({ formData, key: "captionStyle" }),
		trimStartSeconds: numberValue({ formData, key: "trimStartSeconds", fallback: 0 }),
		silenceThreshold:
			stringValue({ formData, key: "silenceThreshold" }) || "-35dB",
		minSilenceDurationSeconds: numberValue({
			formData,
			key: "minSilenceDurationSeconds",
			fallback: 0.8,
		}),
		preSpeechPaddingSeconds: numberValue({
			formData,
			key: "preSpeechPaddingSeconds",
			fallback: 0.25,
		}),
		postSpeechPaddingSeconds: numberValue({
			formData,
			key: "postSpeechPaddingSeconds",
			fallback: 0.35,
		}),
		minKeepSegmentSeconds: numberValue({
			formData,
			key: "minKeepSegmentSeconds",
			fallback: 0.8,
		}),
		maxWordsPerCaption: numberValue({
			formData,
			key: "maxWordsPerCaption",
			fallback: 4,
		}),
		maxCaptionDurationSeconds: numberValue({
			formData,
			key: "maxCaptionDurationSeconds",
			fallback: 1.2,
		}),
		captionOffsetSeconds: numberValue({
			formData,
			key: "captionOffsetSeconds",
			fallback: -0.25,
		}),
	};
}

async function resolveModelPath({
	requestedModelPath,
}: {
	requestedModelPath: string;
}): Promise<string> {
	if (requestedModelPath && (await isFile({ path: requestedModelPath }))) {
		return requestedModelPath;
	}
	if (await isFile({ path: DEFAULT_SMALL_MODEL })) {
		return DEFAULT_SMALL_MODEL;
	}
	if (await isFile({ path: DEFAULT_BASE_MODEL })) {
		return DEFAULT_BASE_MODEL;
	}
	throw new Error(
		`No whisper.cpp model found. Expected ${DEFAULT_SMALL_MODEL} or ${DEFAULT_BASE_MODEL}.`,
	);
}

async function isFile({ path }: { path: string }) {
	const metadata = await stat(path).catch(() => null);
	return Boolean(metadata?.isFile());
}

function stringValue({ formData, key }: { formData: FormData; key: string }) {
	const value = formData.get(key);
	return typeof value === "string" ? value.trim() : "";
}

function numberValue({
	formData,
	key,
	fallback,
}: {
	formData: FormData;
	key: string;
	fallback: number;
}) {
	const rawValue = stringValue({ formData, key });
	if (!rawValue) {
		return fallback;
	}

	const value = Number(rawValue);
	return Number.isFinite(value) ? value : fallback;
}

function booleanValue({
	formData,
	key,
	fallback,
}: {
	formData: FormData;
	key: string;
	fallback: boolean;
}) {
	const value = formData.get(key);
	if (value === null) return fallback;
	return value === "true" || value === "on" || value === "1";
}

function captionStyleValue({
	formData,
	key,
}: {
	formData: FormData;
	key: string;
}): CaptionStylePreset {
	const value = stringValue({ formData, key });
	return value === "clean" || value === "minimal" || value === "tiktok"
		? value
		: "tiktok";
}

function safeBaseName({ name }: { name: string }) {
	const withoutExtension = basename(name, extname(name)) || "video";
	return withoutExtension
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "video";
}

function fileResult({ path }: { path: string }) {
	return {
		path,
		url: `/api/automation/roughcut-file?path=${encodeURIComponent(path)}`,
	};
}
