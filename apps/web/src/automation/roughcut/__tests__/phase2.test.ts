/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { generateRoughCutDocument } from "../generate";
import { parseFfprobeJson } from "../media-probe";
import {
	parseSilencedetectOutput,
	protectSegmentsWithTranscriptWords,
	remapCaptionsToSegments,
	silenceRangesToKeepSegments,
} from "../silence";
import type { RoughCutDocument } from "../types";

describe("ffprobe metadata parsing", () => {
	test("reads duration, dimensions, fps, and audio presence", () => {
		const metadata = parseFfprobeJson({
			stdout: JSON.stringify({
				streams: [
					{
						codec_type: "video",
						width: 1920,
						height: 1080,
						avg_frame_rate: "30000/1001",
					},
					{ codec_type: "audio" },
				],
				format: { duration: "12.345000" },
			}),
		});

		expect(metadata.durationSeconds).toBe(12.345);
		expect(metadata.width).toBe(1920);
		expect(metadata.height).toBe(1080);
		expect(metadata.fps).toBeCloseTo(29.97, 2);
		expect(metadata.hasAudio).toBe(true);
	});

	test("protects quiet transcript words that silencedetect marks as silence", () => {
		const initialSegments = silenceRangesToKeepSegments({
			durationSeconds: 12,
			sourceStartSeconds: 0,
			silenceRanges: [
				{ startSeconds: 0, endSeconds: 1.145, durationSeconds: 1.145 },
				{ startSeconds: 10, endSeconds: 11, durationSeconds: 1 },
			],
			preSpeechPaddingSeconds: 0.25,
			postSpeechPaddingSeconds: 0.35,
			minKeepSegmentSeconds: 0.8,
		});

		expect(initialSegments[0].sourceStartSeconds).toBe(0.895);

		const protectedSegments = protectSegmentsWithTranscriptWords({
			segments: initialSegments,
			durationSeconds: 12,
			preSpeechPaddingSeconds: 0.25,
			postSpeechPaddingSeconds: 0.35,
			minKeepSegmentSeconds: 0.8,
			transcript: {
				text: "Hey everybody",
				segments: [
					{
						startSeconds: 0.04,
						endSeconds: 1.05,
						text: "Hey everybody",
						words: [
							{ startSeconds: 0.04, endSeconds: 0.22, text: "Hey" },
							{ startSeconds: 0.22, endSeconds: 1.05, text: "everybody" },
						],
					},
				],
			},
		});

		expect(protectedSegments[0]).toMatchObject({
			sourceStartSeconds: 0,
			sourceEndSeconds: 10.35,
			timelineStartSeconds: 0,
			timelineEndSeconds: 10.35,
		});
	});
});

describe("silencedetect parsing", () => {
	test("parses silence ranges from ffmpeg stderr", () => {
		const ranges = parseSilencedetectOutput({
			stderr: `[silencedetect @ 0x123] silence_start: 1.25
[silencedetect @ 0x123] silence_end: 2.10 | silence_duration: 0.85
[silencedetect @ 0x123] silence_start: 5
[silencedetect @ 0x123] silence_end: 5.5 | silence_duration: 0.5`,
		});

		expect(ranges).toEqual([
			{ startSeconds: 1.25, endSeconds: 2.1, durationSeconds: 0.85 },
			{ startSeconds: 5, endSeconds: 5.5, durationSeconds: 0.5 },
		]);
	});
});

describe("silence ranges to keep segments", () => {
	test("builds padded speech segments and timeline positions", () => {
		const segments = silenceRangesToKeepSegments({
			durationSeconds: 8,
			sourceStartSeconds: 2,
			silenceRanges: [
				{ startSeconds: 3, endSeconds: 4, durationSeconds: 1 },
				{ startSeconds: 6, endSeconds: 7, durationSeconds: 1 },
			],
			preSpeechPaddingSeconds: 0.15,
			postSpeechPaddingSeconds: 0.25,
			minKeepSegmentSeconds: 0.4,
		});

		expect(segments).toEqual([
			{
				sourceStartSeconds: 2,
				sourceEndSeconds: 3.25,
				timelineStartSeconds: 0,
				timelineEndSeconds: 1.25,
				reason: "speech",
			},
			{
				sourceStartSeconds: 3.85,
				sourceEndSeconds: 6.25,
				timelineStartSeconds: 1.25,
				timelineEndSeconds: 3.65,
				reason: "speech",
			},
			{
				sourceStartSeconds: 6.85,
				sourceEndSeconds: 8,
				timelineStartSeconds: 3.65,
				timelineEndSeconds: 4.8,
				reason: "speech",
			},
		]);
	});
});

describe("caption timing remap", () => {
	test("maps source-timed captions onto edited timeline segments", () => {
		const captions = remapCaptionsToSegments({
			captions: [
				{ text: "First", startTimeSeconds: 2.2, durationSeconds: 0.5 },
				{ text: "Second", startTimeSeconds: 4.2, durationSeconds: 0.5 },
			],
			segments: [
				{
					sourceStartSeconds: 2,
					sourceEndSeconds: 3,
					timelineStartSeconds: 0,
					timelineEndSeconds: 1,
					reason: "speech",
				},
				{
					sourceStartSeconds: 4,
					sourceEndSeconds: 5,
					timelineStartSeconds: 1,
					timelineEndSeconds: 2,
					reason: "speech",
				},
			],
		});

		expect(captions).toMatchObject([
			{ text: "First", startTimeSeconds: 0.2, durationSeconds: 0.5 },
			{ text: "Second", startTimeSeconds: 1.2, durationSeconds: 0.5 },
		]);
	});
});

describe("rough-cut schema compatibility", () => {
	test("keeps segment fields optional for existing JSON", () => {
		const legacyDocument: RoughCutDocument = {
			schema: "opencut-roughcut-v1",
			project: {
				name: "Legacy",
				canvasSize: { width: 1080, height: 1920 },
				fps: { numerator: 30, denominator: 1 },
				background: { type: "color", color: "#000000" },
			},
			media: [],
			clips: [],
			captions: [],
		};

		expect(legacyDocument.segments).toBeUndefined();
		expect(legacyDocument.editDecisionList).toBeUndefined();
	});

	test("generates clips from edit segments when provided", () => {
		const document = generateRoughCutDocument({
			videoPath: "input.mp4",
			projectName: "Silence cut",
			durationSeconds: 8,
			segments: [
				{
					sourceStartSeconds: 2,
					sourceEndSeconds: 3,
					timelineStartSeconds: 0,
					timelineEndSeconds: 1,
					reason: "speech",
				},
				{
					sourceStartSeconds: 4,
					sourceEndSeconds: 6,
					timelineStartSeconds: 1,
					timelineEndSeconds: 3,
					reason: "speech",
				},
			],
		});

		expect(document.clips).toMatchObject([
			{ id: "clip-1", sourceStartSeconds: 2, durationSeconds: 1 },
			{ id: "clip-2", sourceStartSeconds: 4, durationSeconds: 2 },
		]);
		expect(document.editDecisionList?.segments).toHaveLength(2);
	});
});
