/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { generateRoughCutDocument } from "../generate";
import { parseRoughCutSubtitleFile } from "../subtitles";

describe("rough cut generator", () => {
	test("creates a vertical rough-cut document with a leading trim", () => {
		const document = generateRoughCutDocument({
			videoPath: "input.mp4",
			projectName: "TikTok rough cut",
			durationSeconds: 30,
		});

		expect(document.schema).toBe("opencut-roughcut-v1");
		expect(document.project.canvasSize).toEqual({ width: 1080, height: 1920 });
		expect(document.media[0]).toMatchObject({
			id: "media-input",
			path: "input.mp4",
			type: "video",
			durationSeconds: 30,
		});
		expect(document.clips[0]).toMatchObject({
			mediaId: "media-input",
			timelineStartSeconds: 0,
			sourceStartSeconds: 2,
			durationSeconds: 28,
		});
		expect(document.clips[0]?.cropZoomKeyframes).toEqual([]);
		expect(document.captions[0]?.text).toBe("MAKE IT PUNCHY");
	});

	test("imports SRT cues as caption records", () => {
		const document = generateRoughCutDocument({
			videoPath: "/tmp/input.mp4",
			projectName: "Captioned",
			durationSeconds: 8,
			subtitleFileName: "captions.srt",
			subtitleInput: `1
00:00:00,300 --> 00:00:01,200
Make it punchy

2
00:00:01,300 --> 00:00:02,100
Keep it moving`,
		});

		expect(document.captions).toHaveLength(2);
		expect(document.captions[0]).toMatchObject({
			text: "Make it punchy",
			startTimeSeconds: 0.3,
			durationSeconds: 0.9,
		});
	});
});

describe("rough cut subtitle parser", () => {
	test("parses hourless VTT timestamps", () => {
		const result = parseRoughCutSubtitleFile({
			fileName: "captions.vtt",
			input: `WEBVTT

00:00.300 --> 00:01.100
MAKE IT PUNCHY`,
		});

		expect(result.skippedCueCount).toBe(0);
		expect(result.captions).toEqual([
			{
				text: "MAKE IT PUNCHY",
				startTimeSeconds: 0.3,
				durationSeconds: 0.8,
			},
		]);
	});
});
