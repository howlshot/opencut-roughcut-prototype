import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import {
	parseWhisperTranscriptJson,
	selectTranscriptionProvider,
} from "../../src/automation/roughcut/transcription";
import type {
	TranscriptResult,
	TranscriptionProvider,
	TranscriptionProviderName,
} from "../../src/automation/roughcut/types";
import { runProcess } from "./ffmpeg";

export interface CliTranscriptionOptions {
	videoPath: string;
	provider: TranscriptionProviderName;
	model?: string | null;
	prompt?: string | null;
}

export function createCliTranscriptionProvider({
	provider = "auto",
}: {
	provider?: TranscriptionProviderName;
} = {}): TranscriptionProvider {
	return {
		name: "local-cli",
		transcribe: ({ videoPath, model, prompt }) =>
			transcribeWithCli({ videoPath, provider, model, prompt }),
	};
}

export async function transcribeWithCli({
	videoPath,
	provider,
	model,
	prompt,
}: CliTranscriptionOptions): Promise<TranscriptResult> {
	const availability = await detectProviderAvailability();
	const resolvedProvider = selectTranscriptionProvider({
		requestedProvider: provider,
		availability,
	});

	if (resolvedProvider === "whispercpp") {
		return transcribeWithWhisperCpp({ videoPath, model, prompt });
	}

	return transcribeWithOpenAiWhisper({ videoPath, model, prompt });
}

async function detectProviderAvailability() {
	return {
		whispercpp:
			!!process.env.WHISPERCPP_BIN ||
			(await commandExists({ command: "whisper-cli" })),
		whisper: await commandExists({ command: "whisper" }),
	};
}

async function transcribeWithWhisperCpp({
	videoPath,
	model,
	prompt,
}: {
	videoPath: string;
	model?: string | null;
	prompt?: string | null;
}): Promise<TranscriptResult> {
	if (!model) {
		throw new Error(
			"whisper.cpp transcription requires --transcription-model pointing to a local model file.",
		);
	}

	const command = process.env.WHISPERCPP_BIN || "whisper-cli";
	const tempDir = await mkdtemp(join(tmpdir(), "opencut-whispercpp-"));
	try {
		const audioPath = join(tempDir, "audio.wav");
		await extractAudioForWhisperCpp({ videoPath, audioPath });

		const outputBase = join(tempDir, "transcript");
		const args = ["-m", model, "-f", audioPath, "-ojf", "-of", outputBase];
		if (prompt) {
			args.push("--prompt", prompt);
		}
		const result = await runProcess({
			command,
			args,
			missingExecutableMessage:
				"whisper.cpp CLI was not found. Install whisper.cpp and ensure whisper-cli is available on PATH, or set WHISPERCPP_BIN.",
		});
		if (result.exitCode !== 0) {
			throw new Error(`whisper.cpp transcription failed: ${result.stderr}`);
		}

		const json = await readFile(`${outputBase}.json`, "utf8");
		const transcript = parseWhisperTranscriptJson({ input: json });
		return { ...transcript, provider: "whispercpp", model };
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function transcribeWithOpenAiWhisper({
	videoPath,
	model,
	prompt,
}: {
	videoPath: string;
	model?: string | null;
	prompt?: string | null;
}): Promise<TranscriptResult> {
	const tempDir = await mkdtemp(join(tmpdir(), "opencut-whisper-"));
	try {
		const args = [
			videoPath,
			"--output_format",
			"json",
			"--output_dir",
			tempDir,
			"--model",
			model || "base",
		];
		if (prompt) {
			args.push("--initial_prompt", prompt);
		}
		const result = await runProcess({
			command: "whisper",
			args,
			missingExecutableMessage:
				"OpenAI Whisper Python CLI was not found. Install it with `pip install openai-whisper` and ensure `whisper` is available on PATH.",
		});
		if (result.exitCode !== 0) {
			throw new Error(`OpenAI Whisper transcription failed: ${result.stderr}`);
		}

		const inputBase = basename(videoPath, extname(videoPath));
		const json = await readFile(join(tempDir, `${inputBase}.json`), "utf8");
		const transcript = parseWhisperTranscriptJson({ input: json });
		return { ...transcript, provider: "whisper", model: model || "base" };
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function extractAudioForWhisperCpp({
	videoPath,
	audioPath,
}: {
	videoPath: string;
	audioPath: string;
}): Promise<void> {
	const result = await runProcess({
		command: "ffmpeg",
		args: [
			"-y",
			"-hide_banner",
			"-nostats",
			"-i",
			videoPath,
			"-ar",
			"16000",
			"-ac",
			"1",
			"-c:a",
			"pcm_s16le",
			audioPath,
		],
		missingExecutableMessage:
			"ffmpeg was not found. whisper.cpp transcription needs ffmpeg to extract WAV audio from video files.",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Audio extraction for whisper.cpp failed: ${result.stderr}`,
		);
	}
}

async function commandExists({
	command,
}: {
	command: string;
}): Promise<boolean> {
	const result = await runProcess({
		command: "sh",
		args: ["-lc", `command -v ${command}`],
		missingExecutableMessage: "Shell was not found while checking CLI tools.",
	});
	return result.exitCode === 0;
}
