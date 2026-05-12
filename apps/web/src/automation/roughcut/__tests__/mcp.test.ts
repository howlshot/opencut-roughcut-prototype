/// <reference types="bun" />

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	createRoughCutMcpHandlers,
	type RoughCutMcpDependencies,
} from "../mcp/handlers";
import { probeVideoInputSchema } from "../mcp/schemas";

function createMockDependencies(
	overrides: Partial<RoughCutMcpDependencies> = {},
): RoughCutMcpDependencies {
	return {
		fileExists: async () => true,
		readTextFile: async () => "{}",
		writeTextFile: async () => undefined,
		probeVideoMetadata: async () => ({
			durationSeconds: 12,
			width: 1920,
			height: 1080,
			fps: 29.97,
			hasAudio: true,
		}),
		detectSilenceRanges: async () => [
			{ startSeconds: 1, endSeconds: 1.6, durationSeconds: 0.6 },
		],
		transcribeWithCli: async ({ provider, model }) => ({
			text: "Make it punchy",
			segments: [
				{ startSeconds: 2.1, endSeconds: 3.1, text: "Make it punchy" },
			],
			provider: provider === "auto" ? "whisper" : provider,
			model: model ?? "base",
		}),
		...overrides,
	};
}

describe("rough-cut MCP schemas", () => {
	test("rejects unknown probe_video input fields", () => {
		expect(() =>
			probeVideoInputSchema.parse({
				videoPath: "input.mp4",
				extra: true,
			}),
		).toThrow();
	});
});

describe("rough-cut MCP handlers", () => {
	test("probe_video returns metadata and vertical format suggestions", async () => {
		const handlers = createRoughCutMcpHandlers(
			createMockDependencies({
				probeVideoMetadata: async () => ({
					durationSeconds: 8,
					width: 1080,
					height: 1920,
					fps: 30,
					hasAudio: true,
				}),
			}),
		);

		const output = await handlers.probeVideo({ videoPath: "input.mp4" });

		expect(output).toMatchObject({
			durationSeconds: 8,
			width: 1080,
			height: 1920,
			suggestedFormat: {
				vertical9x16: true,
				needsCrop: false,
			},
		});
	});

	test("detect_silence returns silence ranges and suggested keep segments", async () => {
		const handlers = createRoughCutMcpHandlers(createMockDependencies());

		const output = await handlers.detectSilence({ videoPath: "input.mp4" });

		expect(output.silenceRanges).toEqual([
			{ startSeconds: 1, endSeconds: 1.6, durationSeconds: 0.6 },
		]);
		expect(output.suggestedKeepSegments.length).toBeGreaterThan(0);
	});

	test("generate_roughcut writes roughcut and transcript JSON through existing pipeline modules", async () => {
		const writes = new Map<string, string>();
		const handlers = createRoughCutMcpHandlers(
			createMockDependencies({
				writeTextFile: async ({ path, value }) => {
					writes.set(path, value);
				},
			}),
		);

		const output = await handlers.generateRoughCut({
			videoPath: "input.mp4",
			roughcutOut: "roughcut.json",
			autoSilenceCut: true,
			autoTranscribe: true,
			transcriptionProvider: "auto",
			captionStyle: "tiktok",
		});

		expect(output.roughcutOut).toBe("roughcut.json");
		expect(output.transcriptOut).toBe("roughcut.transcript.json");
		expect(output.summary.clipCount).toBeGreaterThan(0);
		expect(output.summary.captionCount).toBeGreaterThan(0);
		expect(writes.has("roughcut.json")).toBe(true);
		expect(writes.has("roughcut.transcript.json")).toBe(true);
	});

	test("explain_roughcut summarizes sample JSON", async () => {
		const sampleJson = await readFile(
			join(process.cwd(), "docs/automation/sample-opencut-roughcut-v1.json"),
			"utf8",
		);
		const handlers = createRoughCutMcpHandlers(
			createMockDependencies({
				readTextFile: async () => sampleJson,
			}),
		);

		const output = await handlers.explainRoughCut({
			roughcutJsonPath: "sample.json",
		});

		expect(output.summary).toContain("Project:");
		expect(output.summary).toContain("Canvas: 1080x1920");
		expect(output.summary).toContain("Clips:");
		expect(output.summary).toContain("Captions:");
		expect(output.warnings).toContain(
			"No edit decision list is present; this may be a simple one-clip rough cut.",
		);
	});
});
