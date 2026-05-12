import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type {
	RoughCutCaption,
	RoughCutClip,
	RoughCutDocument,
} from "../../src/automation/roughcut/types";

export interface RenderRoughCutOptions {
	roughCut: RoughCutDocument;
	videoPath?: string | null;
	outputPath: string;
	burnCaptions?: boolean;
	crf?: number;
	preset?: string;
}

export async function renderRoughCutWithFfmpeg({
	roughCut,
	videoPath,
	outputPath,
	burnCaptions = true,
	crf = 20,
	preset = "veryfast",
}: RenderRoughCutOptions): Promise<void> {
	const inputVideoPath = videoPath ?? roughCut.media[0]?.path;
	if (!inputVideoPath) {
		throw new Error("No video path was provided and rough-cut media is empty.");
	}
	if (roughCut.clips.length === 0) {
		throw new Error("Rough-cut JSON has no clips to render.");
	}

	const workDir = await mkdtemp(join(tmpdir(), "opencut-roughcut-render-"));
	try {
		const captionImagePaths =
			burnCaptions && roughCut.captions.length > 0
				? await writeCaptionImages({
						captions: roughCut.captions,
						width: roughCut.project.canvasSize.width,
						height: roughCut.project.canvasSize.height,
						workDir,
					})
				: [];

		const filterPath = join(workDir, "filter.txt");
		const videoLabel = captionImagePaths.length > 0 ? "vout" : "v";
		await writeFile(
			filterPath,
			buildFilterComplex({
				clips: roughCut.clips,
				width: roughCut.project.canvasSize.width,
				height: roughCut.project.canvasSize.height,
				captions: captionImagePaths.map((_, index) => roughCut.captions[index]),
			}),
			"utf8",
		);

		const args = [
			"-y",
			"-hide_banner",
			"-i",
			inputVideoPath,
		];
		for (const imagePath of captionImagePaths) {
			args.push("-loop", "1", "-framerate", "30", "-i", imagePath);
		}
		args.push(
			"-filter_complex_script",
			filterPath,
			"-map",
			`[${videoLabel}]`,
			"-map",
			"[a]",
			"-c:v",
			"libx264",
			"-preset",
			preset,
			"-crf",
			String(crf),
			"-c:a",
			"aac",
			"-shortest",
			"-movflags",
			"+faststart",
			outputPath,
		);

		await runFfmpeg(args);
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

export function buildFilterComplex({
	clips,
	width,
	height,
	captions = [],
}: {
	clips: RoughCutClip[];
	width: number;
	height: number;
	captions?: RoughCutCaption[];
}): string {
	const parts: string[] = [];
	for (const [index, clip] of clips.entries()) {
		const sourceStart = formatSeconds(clip.sourceStartSeconds);
		const sourceEnd = formatSeconds(clip.sourceStartSeconds + clip.durationSeconds);
		parts.push(
			`[0:v]trim=start=${sourceStart}:end=${sourceEnd},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[v${index}]`,
		);
		parts.push(
			`[0:a]atrim=start=${sourceStart}:end=${sourceEnd},asetpts=PTS-STARTPTS[a${index}]`,
		);
	}

	const concatInputs = clips
		.map((_, index) => `[v${index}][a${index}]`)
		.join("");
	parts.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[v][a]`);

	let currentVideoLabel = "v";
	for (const [index, caption] of captions.entries()) {
		const nextVideoLabel = index === captions.length - 1 ? "vout" : `vc${index}`;
		const start = formatSeconds(caption.startTimeSeconds);
		const end = formatSeconds(caption.startTimeSeconds + caption.durationSeconds);
		parts.push(
			`[${currentVideoLabel}][${index + 1}:v]overlay=0:0:enable='between(t,${start},${end})'[${nextVideoLabel}]`,
		);
		currentVideoLabel = nextVideoLabel;
	}

	return parts.join(";");
}

export function buildCaptionSvg({
	caption,
	width,
	height,
}: {
	caption: RoughCutCaption;
	width: number;
	height: number;
}): string {
	const style = caption.style;
	const fontSize = style?.fontSize && style.fontSize <= 20
		? style.fontSize * 10
		: (style?.fontSize ?? 72);
	const marginV = Math.round(
		(style?.placement?.marginVerticalRatio ?? 0.08) * height,
	);
	const lines = wrapCaptionText({ text: caption.text, maxCharsPerLine: 18 });
	const lineHeight = fontSize * (style?.lineHeight ?? 1.15);
	const blockHeight = (lines.length - 1) * lineHeight;
	const bottomY =
		style?.placement?.verticalAlign === "top"
			? marginV + blockHeight + fontSize
			: style?.placement?.verticalAlign === "middle"
				? height / 2 - blockHeight / 2 + fontSize / 2
				: height - marginV - blockHeight;
	const fontWeight = style?.fontWeight === "bold" ? 800 : 500;
	const textColor = style?.color ?? "#ffffff";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .caption {
      font-family: ${JSON.stringify(style?.fontFamily ?? "Arial")}, sans-serif;
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      fill: ${textColor};
      stroke: #000000;
      stroke-width: 8px;
      paint-order: stroke fill;
      text-anchor: middle;
      dominant-baseline: alphabetic;
    }
  </style>
  <text class="caption" x="${width / 2}" y="${bottomY}">
${lines
	.map((line, index) => {
		const dy = index === 0 ? 0 : lineHeight;
		return `    <tspan x="${width / 2}" dy="${dy}">${escapeXml(line)}</tspan>`;
	})
	.join("\n")}
  </text>
</svg>`;
}

async function writeCaptionImages({
	captions,
	width,
	height,
	workDir,
}: {
	captions: RoughCutCaption[];
	width: number;
	height: number;
	workDir: string;
}): Promise<string[]> {
	const { default: sharp } = await import("sharp");
	const paths: string[] = [];
	for (const [index, caption] of captions.entries()) {
		if (caption.durationSeconds <= 0) continue;
		const path = join(workDir, `caption-${index}.png`);
		await sharp(Buffer.from(buildCaptionSvg({ caption, width, height })))
			.png()
			.toFile(path);
		paths.push(path);
	}
	return paths;
}

function wrapCaptionText({
	text,
	maxCharsPerLine,
}: {
	text: string;
	maxCharsPerLine: number;
}): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length > maxCharsPerLine && current) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines.slice(0, 2);
}

function formatSeconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

async function runFfmpeg(args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("ffmpeg", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			reject(
				new Error(
					error.message.includes("ENOENT")
						? "ffmpeg was not found. Install FFmpeg and make sure it is on PATH."
						: error.message,
				),
			);
		});
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`ffmpeg failed with exit code ${code}.\n${stderr}`));
		});
	});
}
