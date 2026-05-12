/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../../../scripts/generate-roughcut";
import { remapCaptionsToSegments } from "../silence";
import {
	applyCaptionOffset,
	captionStyleForPreset,
	parseWhisperTranscriptJson,
	selectTranscriptionProvider,
	transcriptToTimelineCaptions,
	transcriptToCaptions,
} from "../transcription";
import type { TranscriptResult } from "../types";

const TRANSCRIPT: TranscriptResult = {
	text: "Hook viewers fast then explain the point with clear simple words",
	segments: [
		{
			startSeconds: 2,
			endSeconds: 6,
			text: "Hook viewers fast then explain the point with clear simple words",
			words: [
				{ startSeconds: 2, endSeconds: 2.4, text: "Hook" },
				{ startSeconds: 2.4, endSeconds: 2.8, text: "viewers" },
				{ startSeconds: 2.8, endSeconds: 3.2, text: "fast" },
				{ startSeconds: 3.2, endSeconds: 3.6, text: "then" },
				{ startSeconds: 3.6, endSeconds: 4, text: "explain" },
				{ startSeconds: 4, endSeconds: 4.4, text: "the" },
				{ startSeconds: 4.4, endSeconds: 4.8, text: "point" },
				{ startSeconds: 4.8, endSeconds: 5.2, text: "with" },
				{ startSeconds: 5.2, endSeconds: 5.6, text: "clear" },
				{ startSeconds: 5.6, endSeconds: 6, text: "simple" },
			],
		},
	],
};

describe("transcript to captions", () => {
	test("chunks transcript words into short TikTok-style captions", () => {
		const captions = transcriptToCaptions({
			transcript: TRANSCRIPT,
			maxWordsPerCaption: 4,
			maxCaptionDurationSeconds: 2.5,
		});

		expect(captions).toMatchObject([
			{
				text: "Hook viewers fast then",
				startTimeSeconds: 2,
				durationSeconds: 1.6,
			},
			{
				text: "explain the point with",
				startTimeSeconds: 3.6,
				durationSeconds: 1.6,
			},
			{
				text: "clear simple",
				startTimeSeconds: 5.2,
				durationSeconds: 0.8,
			},
		]);
		expect(captions[0].style?.fontWeight).toBe("bold");
		expect(captions[0].style?.fontSize).toBe(7);
	});

	test("applies caption style presets", () => {
		expect(captionStyleForPreset({ preset: "minimal" })).toMatchObject({
			fontSize: 4.5,
			fontWeight: "normal",
		});
		expect(captionStyleForPreset({ preset: "clean" }).background).toMatchObject(
			{
				enabled: true,
				color: "#000000",
			},
		);
	});

	test("keeps protected phrases together", () => {
		const captions = transcriptToCaptions({
			transcript: {
				text: "Botox ice baths. Are popular",
				segments: [
					{
						startSeconds: 0,
						endSeconds: 2,
						text: "Botox ice baths. Are popular",
						words: [
							{ startSeconds: 0, endSeconds: 0.2, text: "Botox" },
							{ startSeconds: 0.2, endSeconds: 0.4, text: "ice" },
							{ startSeconds: 0.4, endSeconds: 1.4, text: "baths." },
							{ startSeconds: 1.4, endSeconds: 1.7, text: "Are" },
							{ startSeconds: 1.7, endSeconds: 2, text: "popular" },
						],
					},
				],
			},
			maxWordsPerCaption: 2,
			maxCaptionDurationSeconds: 1.2,
			protectedPhrases: ["ice baths"],
			avoidSingleWordCaptions: false,
		});

		expect(captions.map((caption) => caption.text)).toEqual([
			"Botox",
			"ice baths.",
			"Are popular",
		]);
	});

	test("merges awkward one-word captions into nearby captions", () => {
		const captions = transcriptToCaptions({
			transcript: {
				text: "Ice baths are cold",
				segments: [
					{
						startSeconds: 0,
						endSeconds: 1.5,
						text: "Ice baths are cold",
						words: [
							{ startSeconds: 0, endSeconds: 0.2, text: "Ice" },
							{ startSeconds: 0.2, endSeconds: 0.4, text: "baths" },
							{ startSeconds: 0.4, endSeconds: 1.2, text: "are" },
							{ startSeconds: 1.2, endSeconds: 1.5, text: "cold" },
						],
					},
				],
			},
			maxWordsPerCaption: 2,
			maxCaptionDurationSeconds: 0.5,
			protectedPhrases: [],
		});

		expect(captions.map((caption) => caption.text)).toEqual([
			"Ice baths",
			"are cold",
		]);
	});
});

describe("transcript caption remap", () => {
	test("shifts captions earlier with a global offset", () => {
		expect(
			applyCaptionOffset({
				captions: [
					{ text: "early", startTimeSeconds: 0.1, durationSeconds: 0.5 },
					{ text: "later", startTimeSeconds: 1, durationSeconds: 0.5 },
				],
				offsetSeconds: -0.2,
			}),
		).toEqual([
			{ text: "early", startTimeSeconds: 0, durationSeconds: 0.4 },
			{ text: "later", startTimeSeconds: 0.8, durationSeconds: 0.5 },
		]);
	});

	test("maps generated transcript captions onto silence-cut timeline segments", () => {
		const remapped = transcriptToTimelineCaptions({
			transcript: {
				text: "Before cut after cut",
				segments: [
					{
						startSeconds: 2.1,
						endSeconds: 5.3,
						text: "Before cut after cut",
						words: [
							{ startSeconds: 2.1, endSeconds: 2.4, text: "Before" },
							{ startSeconds: 2.4, endSeconds: 2.7, text: "cut" },
							{ startSeconds: 5.0, endSeconds: 5.2, text: "after" },
							{ startSeconds: 5.2, endSeconds: 5.3, text: "cut" },
						],
					},
				],
			},
			segments: [
				{
					sourceStartSeconds: 2,
					sourceEndSeconds: 3,
					timelineStartSeconds: 0,
					timelineEndSeconds: 1,
					reason: "speech",
				},
				{
					sourceStartSeconds: 5,
					sourceEndSeconds: 6,
					timelineStartSeconds: 1,
					timelineEndSeconds: 2,
					reason: "speech",
				},
			],
			maxWordsPerCaption: 2,
			maxCaptionDurationSeconds: 0.8,
		});

		expect(remapped).toMatchObject([
			{ text: "Before cut", startTimeSeconds: 0.1, durationSeconds: 0.6 },
			{ text: "after cut", startTimeSeconds: 1, durationSeconds: 0.3 },
		]);
	});

	test("drops removed captions and clips captions that overlap cuts", () => {
		const captions = transcriptToCaptions({
			transcript: {
				text: "Before cut removed after cut",
				segments: [
					{ startSeconds: 2.1, endSeconds: 2.7, text: "Before cut" },
					{ startSeconds: 3.2, endSeconds: 3.8, text: "Removed part" },
					{ startSeconds: 4.7, endSeconds: 5.3, text: "After cut" },
				],
			},
			maxWordsPerCaption: 6,
		});

		const remapped = remapCaptionsToSegments({
			captions,
			segments: [
				{
					sourceStartSeconds: 2,
					sourceEndSeconds: 3,
					timelineStartSeconds: 0,
					timelineEndSeconds: 1,
					reason: "speech",
				},
				{
					sourceStartSeconds: 5,
					sourceEndSeconds: 6,
					timelineStartSeconds: 1,
					timelineEndSeconds: 2,
					reason: "speech",
				},
			],
		});

		expect(remapped).toMatchObject([
			{ text: "Before cut", startTimeSeconds: 0.1, durationSeconds: 0.6 },
			{ text: "After cut", startTimeSeconds: 1, durationSeconds: 0.3 },
		]);
	});
});

describe("whisper.cpp full JSON parsing", () => {
	test("builds word timings from token-level timestamps", () => {
		const transcript = parseWhisperTranscriptJson({
			input: JSON.stringify({
				transcription: [
					{
						timestamps: { from: "00:00:00,000", to: "00:00:01,000" },
						text: " Ice bath.",
						tokens: [
							{
								text: " Ice",
								timestamps: { from: "00:00:00,100", to: "00:00:00,300" },
							},
							{
								text: " bath",
								timestamps: { from: "00:00:00,300", to: "00:00:00,700" },
							},
							{
								text: ".",
								timestamps: { from: "00:00:00,700", to: "00:00:00,750" },
							},
						],
					},
				],
			}),
		});

		expect(transcript.segments[0].words).toEqual([
			{ text: "Ice", startSeconds: 0.1, endSeconds: 0.3 },
			{ text: "bath.", startSeconds: 0.3, endSeconds: 0.75 },
		]);
	});
});

describe("transcription provider selection", () => {
	test("throws a clear error when no local provider is available", () => {
		expect(() =>
			selectTranscriptionProvider({
				requestedProvider: "auto",
				availability: { whispercpp: false, whisper: false },
			}),
		).toThrow("No supported local transcription CLI found");
	});
});

describe("rough-cut CLI args", () => {
	test("parses transcription output and caption flags", () => {
		const options = parseArgs({
			args: [
				"--video",
				"input.mp4",
				"--auto-transcribe",
				"--transcription-provider",
				"whisper",
				"--transcription-model",
				"small",
				"--transcription-prompt",
				"Canyon Ranch, wellness",
				"--captions-from-transcript",
				"--caption-style",
				"clean",
				"--max-words-per-caption",
				"4",
				"--max-caption-duration",
				"1.2",
				"--caption-offset-seconds",
				"-0.2",
				"--protected-phrase",
				"ice baths",
				"--protected-phrase",
				"Canyon Ranch",
				"--transcript-out",
				"transcript.json",
				"--roughcut-out",
				"roughcut.json",
			],
		});

		expect(options).toMatchObject({
			videoPath: "input.mp4",
			autoTranscribe: true,
			transcriptionProvider: "whisper",
			transcriptionModel: "small",
			transcriptionPrompt: "Canyon Ranch, wellness",
			captionsFromTranscript: true,
			captionStyle: "clean",
			maxWordsPerCaption: 4,
			maxCaptionDurationSeconds: 1.2,
			captionOffsetSeconds: -0.2,
			protectedPhrases: ["ice baths", "Canyon Ranch"],
			transcriptOutputPath: "transcript.json",
			roughcutOutputPath: "roughcut.json",
		});
	});

	test("keeps --out as the rough-cut output alias", () => {
		const options = parseArgs({
			args: ["--video", "input.mp4", "--out", "roughcut.json"],
		});

		expect(options.roughcutOutputPath).toBe("roughcut.json");
	});
});
