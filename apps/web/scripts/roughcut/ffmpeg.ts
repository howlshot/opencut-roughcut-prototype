import { spawn } from "node:child_process";
import { parseFfprobeJson } from "../../src/automation/roughcut/media-probe";
import { parseSilencedetectOutput } from "../../src/automation/roughcut/silence";
import type { VideoMetadata } from "../../src/automation/roughcut/media-probe";
import type { SilenceRange } from "../../src/automation/roughcut/silence";

export interface DetectSilenceOptions {
	threshold: string;
	minSilenceDurationSeconds: number;
}

export async function probeVideoMetadata({
	videoPath,
}: {
	videoPath: string;
}): Promise<VideoMetadata> {
	const result = await runProcess({
		command: "ffprobe",
		args: [
			"-v",
			"error",
			"-print_format",
			"json",
			"-show_format",
			"-show_streams",
			videoPath,
		],
		missingExecutableMessage:
			"ffprobe was not found. Install FFmpeg and ensure ffprobe is available on PATH.",
	});

	if (result.exitCode !== 0) {
		throw new Error(`ffprobe failed: ${result.stderr || result.stdout}`);
	}

	return parseFfprobeJson({ stdout: result.stdout });
}

export async function detectSilenceRanges({
	videoPath,
	threshold,
	minSilenceDurationSeconds,
}: {
	videoPath: string;
} & DetectSilenceOptions): Promise<SilenceRange[]> {
	const result = await runProcess({
		command: "ffmpeg",
		args: [
			"-hide_banner",
			"-nostats",
			"-i",
			videoPath,
			"-af",
			`silencedetect=noise=${threshold}:d=${minSilenceDurationSeconds}`,
			"-f",
			"null",
			"-",
		],
		missingExecutableMessage:
			"ffmpeg was not found. Install FFmpeg and ensure ffmpeg is available on PATH.",
	});

	if (result.exitCode !== 0) {
		throw new Error(`ffmpeg silencedetect failed: ${result.stderr}`);
	}

	return parseSilencedetectOutput({ stderr: result.stderr });
}

export function runProcess({
	command,
	args,
	missingExecutableMessage,
}: {
	command: string;
	args: string[];
	missingExecutableMessage: string;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				reject(new Error(missingExecutableMessage));
				return;
			}
			reject(error);
		});
		child.on("close", (exitCode) => {
			resolve({ exitCode, stdout, stderr });
		});
	});
}
