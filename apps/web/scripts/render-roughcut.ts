import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RoughCutDocument } from "../src/automation/roughcut/types";
import { renderRoughCutWithFfmpeg } from "./roughcut/render-ffmpeg";

interface CliOptions {
	roughCutPath: string | null;
	videoPath: string | null;
	outputPath: string | null;
	burnCaptions: boolean;
	crf: number;
	preset: string;
}

async function main() {
	const options = parseArgs({ args: process.argv.slice(2) });
	if (!options.roughCutPath || !options.outputPath) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	const roughCut = JSON.parse(
		await readFile(options.roughCutPath, "utf8"),
	) as RoughCutDocument;

	await renderRoughCutWithFfmpeg({
		roughCut,
		videoPath: options.videoPath,
		outputPath: options.outputPath,
		burnCaptions: options.burnCaptions,
		crf: options.crf,
		preset: options.preset,
	});

	console.log(`Wrote ${resolve(options.outputPath)}`);
}

export function parseArgs({ args }: { args: string[] }): CliOptions {
	const options: CliOptions = {
		roughCutPath: null,
		videoPath: null,
		outputPath: null,
		burnCaptions: true,
		crf: 20,
		preset: "veryfast",
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const value = args[index + 1];

		switch (arg) {
			case "--roughcut":
			case "--roughcut-json":
				options.roughCutPath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--video":
				options.videoPath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--out":
				options.outputPath = requireValue({ flag: arg, value });
				index += 1;
				break;
			case "--no-captions":
				options.burnCaptions = false;
				break;
			case "--crf":
				options.crf = parseNumberArg({ flag: arg, value });
				index += 1;
				break;
			case "--preset":
				options.preset = requireValue({ flag: arg, value });
				index += 1;
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

function printUsage() {
	console.log(`Usage:
  bun apps/web/scripts/render-roughcut.ts --roughcut roughcut.json --out output.mp4 [options]

Options:
  --video path        Override source video path from rough-cut JSON
  --no-captions      Do not burn captions into the rendered MP4
  --crf number       x264 quality. Lower is higher quality. Default: 20
  --preset value     x264 preset. Default: veryfast
`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
