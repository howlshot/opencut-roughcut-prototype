/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../../../scripts/render-roughcut";
import { roughCutCaptionsToSrt } from "../../../../scripts/roughcut/export-srt";
import {
	buildCaptionSvg,
	buildFilterComplex,
} from "../../../../scripts/roughcut/render-ffmpeg";

describe("rough-cut ffmpeg renderer", () => {
	test("builds a vertical cut/crop filter from rough-cut clips", () => {
		const filter = buildFilterComplex({
			width: 1080,
			height: 1920,
			clips: [
				{
					id: "clip-1",
					mediaId: "media-input",
					type: "video",
					timelineStartSeconds: 0,
					sourceStartSeconds: 2,
					durationSeconds: 3.5,
					params: {},
					cropZoomKeyframes: [],
				},
				{
					id: "clip-2",
					mediaId: "media-input",
					type: "video",
					timelineStartSeconds: 3.5,
					sourceStartSeconds: 8,
					durationSeconds: 1,
					params: {},
					cropZoomKeyframes: [],
				},
			],
			captions: [
				{
					text: "MAKE IT PUNCHY",
					startTimeSeconds: 0.3,
					durationSeconds: 0.9,
				},
			],
		});

		expect(filter).toContain(
			"[0:v]trim=start=2:end=5.500000,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]",
		);
		expect(filter).toContain(
			"[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
		);
		expect(filter).toContain(
			"[v][1:v]overlay=0:0:enable='between(t,0.300000,1.200000)'[vout]",
		);
	});

	test("builds SVG caption overlays for burned-in subtitles", () => {
		const svg = buildCaptionSvg({
			width: 1080,
			height: 1920,
			caption: {
				text: "MAKE IT PUNCHY",
				startTimeSeconds: 0.3,
				durationSeconds: 0.9,
				style: {
					fontFamily: "Arial",
					fontSize: 7,
					color: "#ffffff",
					fontWeight: "bold",
					placement: {
						verticalAlign: "bottom",
						marginVerticalRatio: 0.08,
					},
				},
			},
		});

		expect(svg).toContain('width="1080"');
		expect(svg).toContain('height="1920"');
		expect(svg).toContain("font-size: 70px");
		expect(svg).toContain("font-weight: 800");
		expect(svg).toContain("MAKE IT PUNCHY");
	});

	test("parses render CLI arguments", () => {
		expect(
			parseArgs({
				args: [
					"--roughcut",
					"roughcut.json",
					"--video",
					"input.mp4",
					"--out",
					"output.mp4",
					"--no-captions",
					"--crf",
					"18",
				],
			}),
		).toMatchObject({
			roughCutPath: "roughcut.json",
			videoPath: "input.mp4",
			outputPath: "output.mp4",
			burnCaptions: false,
			crf: 18,
		});
	});

	test("exports rough-cut captions to SRT", () => {
		const srt = roughCutCaptionsToSrt({
			roughCut: {
				schema: "opencut-roughcut-v1",
				project: {
					name: "Test",
					canvasSize: { width: 1080, height: 1920 },
					fps: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#000000" },
				},
				media: [],
				clips: [],
				captions: [
					{
						text: "ice baths.",
						startTimeSeconds: 9.577,
						durationSeconds: 2.105,
					},
				],
			},
		});

		expect(srt).toBe(
			"1\n00:00:09,577 --> 00:00:11,682\nice baths.\n",
		);
	});
});
