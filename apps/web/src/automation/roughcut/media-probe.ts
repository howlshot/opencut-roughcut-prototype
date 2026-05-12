export interface VideoMetadata {
	durationSeconds: number | null;
	width: number | null;
	height: number | null;
	fps: number | null;
	hasAudio: boolean;
}

interface FfprobeStream {
	codec_type?: string;
	width?: number;
	height?: number;
	r_frame_rate?: string;
	avg_frame_rate?: string;
}

interface FfprobeFormat {
	duration?: string;
}

interface FfprobeOutput {
	streams?: FfprobeStream[];
	format?: FfprobeFormat;
}

export function parseFfprobeJson({
	stdout,
}: {
	stdout: string;
}): VideoMetadata {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch (error) {
		throw new Error(
			`Could not parse ffprobe JSON output: ${
				error instanceof Error ? error.message : "unknown error"
			}`,
		);
	}

	const output = toFfprobeOutput({ value: parsed });
	const streams = output.streams ?? [];
	const videoStream = streams.find((stream) => stream.codec_type === "video");
	const hasAudio = streams.some((stream) => stream.codec_type === "audio");

	return {
		durationSeconds: parseFiniteNumber({ value: output.format?.duration }),
		width: parsePositiveInteger({ value: videoStream?.width }),
		height: parsePositiveInteger({ value: videoStream?.height }),
		fps:
			parseFrameRate({ value: videoStream?.avg_frame_rate }) ??
			parseFrameRate({ value: videoStream?.r_frame_rate }),
		hasAudio,
	};
}

function parseFiniteNumber({
	value,
}: {
	value: string | number | undefined;
}): number | null {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger({
	value,
}: {
	value: number | undefined;
}): number | null {
	if (typeof value !== "number") {
		return null;
	}
	return Number.isInteger(value) && value > 0 ? value : null;
}

function parseFrameRate({
	value,
}: {
	value: string | undefined;
}): number | null {
	if (!value || value === "0/0") {
		return null;
	}

	const [rawNumerator, rawDenominator] = value.split("/");
	const numerator = Number(rawNumerator);
	const denominator = rawDenominator === undefined ? 1 : Number(rawDenominator);
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
		return null;
	}
	if (denominator === 0) {
		return null;
	}

	const fps = numerator / denominator;
	return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function toFfprobeOutput({ value }: { value: unknown }): FfprobeOutput {
	if (!isRecord(value)) {
		return {};
	}

	return {
		streams: Array.isArray(value.streams)
			? value.streams.map((stream) => toFfprobeStream({ value: stream }))
			: undefined,
		format: isRecord(value.format)
			? {
					duration:
						typeof value.format.duration === "string"
							? value.format.duration
							: undefined,
				}
			: undefined,
	};
}

function toFfprobeStream({ value }: { value: unknown }): FfprobeStream {
	if (!isRecord(value)) {
		return {};
	}

	return {
		codec_type:
			typeof value.codec_type === "string" ? value.codec_type : undefined,
		width: typeof value.width === "number" ? value.width : undefined,
		height: typeof value.height === "number" ? value.height : undefined,
		r_frame_rate:
			typeof value.r_frame_rate === "string" ? value.r_frame_rate : undefined,
		avg_frame_rate:
			typeof value.avg_frame_rate === "string"
				? value.avg_frame_rate
				: undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
