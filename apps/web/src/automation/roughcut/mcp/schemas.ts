import * as z from "zod/v4";

export const transcriptionProviderSchema = z.enum([
	"whispercpp",
	"whisper",
	"auto",
]);

export const captionStyleSchema = z.enum(["tiktok", "clean", "minimal"]);

export const probeVideoInputShape = {
	videoPath: z.string().min(1).describe("Local path to a video file."),
};
export const probeVideoInputSchema = z.object(probeVideoInputShape).strict();

export const detectSilenceInputShape = {
	videoPath: z.string().min(1).describe("Local path to a video file."),
	silenceThreshold: z
		.string()
		.default("-35dB")
		.describe("FFmpeg silencedetect noise threshold."),
	minSilenceDuration: z
		.number()
		.nonnegative()
		.default(0.35)
		.describe("Minimum silence duration in seconds."),
};
export const detectSilenceInputSchema = z
	.object(detectSilenceInputShape)
	.strict();

export const transcribeVideoInputShape = {
	videoPath: z.string().min(1).describe("Local path to a video file."),
	provider: transcriptionProviderSchema
		.default("auto")
		.describe("Local transcription CLI provider."),
	model: z
		.string()
		.min(1)
		.optional()
		.describe("whisper.cpp model path or openai-whisper model name."),
	transcriptOut: z
		.string()
		.min(1)
		.optional()
		.describe("Optional transcript JSON output path."),
};
export const transcribeVideoInputSchema = z
	.object(transcribeVideoInputShape)
	.strict();

export const generateRoughCutInputShape = {
	videoPath: z.string().min(1).describe("Local path to a video file."),
	roughcutOut: z.string().min(1).describe("Rough-cut JSON output path."),
	durationSeconds: z
		.number()
		.positive()
		.optional()
		.describe("Optional source duration override."),
	autoSilenceCut: z.boolean().default(false),
	autoTranscribe: z.boolean().default(false),
	transcriptionProvider: transcriptionProviderSchema.default("auto"),
	transcriptionModel: z.string().min(1).optional(),
	captionStyle: captionStyleSchema.default("tiktok"),
	silenceThreshold: z.string().default("-35dB"),
	minSilenceDuration: z.number().nonnegative().default(0.35),
	promptNotes: z.string().optional(),
};
export const generateRoughCutInputSchema = z
	.object(generateRoughCutInputShape)
	.strict();

export const explainRoughCutInputShape = {
	roughcutJsonPath: z.string().min(1).describe("Path to rough-cut JSON."),
};
export const explainRoughCutInputSchema = z
	.object(explainRoughCutInputShape)
	.strict();

export const silenceRangeSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	durationSeconds: z.number(),
});

export const editSegmentSchema = z.object({
	sourceStartSeconds: z.number(),
	sourceEndSeconds: z.number(),
	timelineStartSeconds: z.number(),
	timelineEndSeconds: z.number(),
	reason: z.enum(["speech", "manual", "ai", "unknown"]),
});

export const transcriptSegmentSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	text: z.string(),
	words: z
		.array(
			z.object({
				startSeconds: z.number(),
				endSeconds: z.number(),
				text: z.string(),
			}),
		)
		.optional(),
});

export const probeVideoOutputShape = {
	durationSeconds: z.number().nullable(),
	width: z.number().nullable(),
	height: z.number().nullable(),
	fps: z.number().nullable(),
	hasAudio: z.boolean(),
	suggestedFormat: z.object({
		vertical9x16: z.boolean(),
		needsCrop: z.boolean(),
		notes: z.array(z.string()),
	}),
};

export const detectSilenceOutputShape = {
	silenceRanges: z.array(silenceRangeSchema),
	suggestedKeepSegments: z.array(editSegmentSchema),
};

export const transcribeVideoOutputShape = {
	transcriptSegments: z.array(transcriptSegmentSchema),
	transcriptOut: z.string().optional(),
	providerUsed: z.string(),
};

export const generateRoughCutOutputShape = {
	roughcutOut: z.string(),
	transcriptOut: z.string().optional(),
	summary: z.object({
		clipCount: z.number(),
		captionCount: z.number(),
		originalDuration: z.number().nullable(),
		editedDuration: z.number(),
		removedDuration: z.number().nullable(),
	}),
};

export const explainRoughCutOutputShape = {
	summary: z.string(),
	warnings: z.array(z.string()),
};
