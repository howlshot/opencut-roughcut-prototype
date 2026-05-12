import type { RoughCutCaption } from "./types";

interface ParseCaptionResult {
	captions: RoughCutCaption[];
	skippedCueCount: number;
	warnings: string[];
}

const TIMESTAMP_SEPARATOR = /\s*-->\s*/;

export function parseRoughCutSubtitleFile({
	fileName,
	input,
}: {
	fileName: string;
	input: string;
}): ParseCaptionResult {
	const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

	if (extension === "srt") {
		return parseSrtCaptions({ input });
	}

	if (extension === "vtt") {
		return parseVttCaptions({ input });
	}

	return {
		captions: [],
		skippedCueCount: 0,
		warnings: [`Unsupported subtitle format: ${extension || "unknown"}`],
	};
}

function parseSrtCaptions({ input }: { input: string }): ParseCaptionResult {
	return parseTimestampBlocks({
		input,
		allowHourlessTimestamps: false,
		stripWebVttHeader: false,
	});
}

function parseVttCaptions({ input }: { input: string }): ParseCaptionResult {
	return parseTimestampBlocks({
		input,
		allowHourlessTimestamps: true,
		stripWebVttHeader: true,
	});
}

function parseTimestampBlocks({
	input,
	allowHourlessTimestamps,
	stripWebVttHeader,
}: {
	input: string;
	allowHourlessTimestamps: boolean;
	stripWebVttHeader: boolean;
}): ParseCaptionResult {
	let normalized = input
		.replace(/\uFEFF/g, "")
		.replace(/\r\n?/g, "\n")
		.trim();
	if (stripWebVttHeader) {
		normalized = normalized.replace(/^WEBVTT[^\n]*(\n|$)/, "").trim();
	}

	if (!normalized) {
		return { captions: [], skippedCueCount: 0, warnings: [] };
	}

	const captions: RoughCutCaption[] = [];
	let skippedCueCount = 0;

	for (const block of normalized.split(/\n{2,}/)) {
		const lines = block
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		const timestampIndex = lines.findIndex((line) =>
			TIMESTAMP_SEPARATOR.test(line),
		);

		if (timestampIndex < 0) {
			skippedCueCount += 1;
			continue;
		}

		const timestampLine = lines[timestampIndex];
		const [rawStart, rawEndWithSettings] =
			timestampLine.split(TIMESTAMP_SEPARATOR);
		const rawEnd = rawEndWithSettings?.split(/\s+/)[0];
		const text = lines
			.slice(timestampIndex + 1)
			.join("\n")
			.trim();

		if (!rawStart || !rawEnd || !text) {
			skippedCueCount += 1;
			continue;
		}

		const startTime = parseTimestamp({
			input: rawStart,
			allowHourlessTimestamps,
		});
		const endTime = parseTimestamp({
			input: rawEnd,
			allowHourlessTimestamps,
		});
		const duration = endTime - startTime;

		if (
			!Number.isFinite(startTime) ||
			!Number.isFinite(endTime) ||
			duration <= 0
		) {
			skippedCueCount += 1;
			continue;
		}

		captions.push({
			text: text.replace(/<[^>]*>/g, ""),
			startTimeSeconds: roundSeconds({ seconds: startTime }),
			durationSeconds: roundSeconds({ seconds: duration }),
		});
	}

	return {
		captions,
		skippedCueCount,
		warnings: [],
	};
}

function roundSeconds({ seconds }: { seconds: number }): number {
	return Math.round(seconds * 1000) / 1000;
}

function parseTimestamp({
	input,
	allowHourlessTimestamps,
}: {
	input: string;
	allowHourlessTimestamps: boolean;
}): number {
	const normalized = input.trim().replace(",", ".");
	const pattern = allowHourlessTimestamps
		? /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{1,3})$/
		: /^(\d{2,}):(\d{2}):(\d{2})\.(\d{1,3})$/;
	const match = normalized.match(pattern);
	if (!match) {
		return Number.NaN;
	}

	const [, maybeHours, minutes, seconds, milliseconds] = match;
	const parsedHours = maybeHours ? Number.parseInt(maybeHours, 10) : 0;
	const parsedMinutes = Number.parseInt(minutes, 10);
	const parsedSeconds = Number.parseInt(seconds, 10);
	const parsedMilliseconds = Number.parseInt(milliseconds.padEnd(3, "0"), 10);

	return (
		parsedHours * 3600 +
		parsedMinutes * 60 +
		parsedSeconds +
		parsedMilliseconds / 1000
	);
}
