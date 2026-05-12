export const ROUGHCUT_SCHEMA_VERSION = "opencut-roughcut-v1" as const;

export type RoughCutSchemaVersion = typeof ROUGHCUT_SCHEMA_VERSION;

export type RoughCutMediaType = "video" | "audio" | "image";

export interface RoughCutCanvasSize {
	width: number;
	height: number;
}

export interface RoughCutFrameRate {
	numerator: number;
	denominator: number;
}

export type RoughCutBackground =
	| { type: "color"; color: string }
	| { type: "blur"; blurIntensity: number };

export interface RoughCutProjectSettings {
	name: string;
	canvasSize: RoughCutCanvasSize;
	fps: RoughCutFrameRate;
	background: RoughCutBackground;
}

export interface RoughCutMediaItem {
	id: string;
	path: string;
	type: RoughCutMediaType;
	name: string;
	durationSeconds: number | null;
	width: number | null;
	height: number | null;
	fps?: number | null;
	hasAudio?: boolean | null;
}

export type RoughCutParamValue = string | number | boolean;
export type RoughCutParamValues = Record<string, RoughCutParamValue>;

export interface RoughCutKeyframePlaceholder {
	propertyPath: string;
	timeSeconds: number;
	value: RoughCutParamValue;
	interpolation?: "linear" | "hold" | "bezier";
}

export interface RoughCutClip {
	id: string;
	mediaId: string;
	type: RoughCutMediaType;
	timelineStartSeconds: number;
	sourceStartSeconds: number;
	durationSeconds: number;
	params: RoughCutParamValues;
	cropZoomKeyframes: RoughCutKeyframePlaceholder[];
}

export type RoughCutEditReason = "speech" | "manual" | "ai" | "unknown";

export interface RoughCutEditSegment {
	sourceStartSeconds: number;
	sourceEndSeconds: number;
	timelineStartSeconds: number;
	timelineEndSeconds: number;
	reason: RoughCutEditReason;
}

export interface RoughCutEditDecisionList {
	segments: RoughCutEditSegment[];
	source?: "silence-detect" | "manual" | "ai" | "unknown";
	notes?: string[];
}

export interface RoughCutCaptionStyle {
	fontFamily?: string;
	fontSize?: number;
	color?: string;
	fontWeight?: "normal" | "bold";
	fontStyle?: "normal" | "italic";
	textDecoration?: "none" | "underline" | "line-through";
	textAlign?: "left" | "center" | "right";
	letterSpacing?: number;
	lineHeight?: number;
	background?: {
		enabled?: boolean;
		color?: string;
		cornerRadius?: number;
		paddingX?: number;
		paddingY?: number;
		offsetX?: number;
		offsetY?: number;
	};
	placement?: {
		verticalAlign?: "top" | "middle" | "bottom";
		marginLeftRatio?: number;
		marginRightRatio?: number;
		marginVerticalRatio?: number;
	};
}

export interface RoughCutCaption {
	text: string;
	startTimeSeconds: number;
	durationSeconds: number;
	style?: RoughCutCaptionStyle;
}

export interface TranscriptWord {
	startSeconds: number;
	endSeconds: number;
	text: string;
}

export interface TranscriptSegment {
	startSeconds: number;
	endSeconds: number;
	text: string;
	words?: TranscriptWord[];
}

export interface TranscriptResult {
	text: string;
	segments: TranscriptSegment[];
	language?: string;
	provider?: string;
	model?: string;
}

export interface TranscriptionInput {
	videoPath: string;
	model?: string | null;
	language?: string | null;
	prompt?: string | null;
}

export interface TranscriptionProvider {
	name: string;
	transcribe(input: TranscriptionInput): Promise<TranscriptResult>;
}

export type TranscriptionProviderName = "whispercpp" | "whisper" | "auto";

export type CaptionStylePreset = "tiktok" | "clean" | "minimal";

export interface RoughCutDocument {
	schema: RoughCutSchemaVersion;
	project: RoughCutProjectSettings;
	media: RoughCutMediaItem[];
	clips: RoughCutClip[];
	captions: RoughCutCaption[];
	segments?: RoughCutEditSegment[];
	editDecisionList?: RoughCutEditDecisionList;
	metadata?: {
		prompt?: string;
		generator?: string;
		createdAt?: string;
		notes?: string[];
	};
}

export interface GenerateRoughCutOptions {
	videoPath: string;
	projectName: string;
	subtitleInput?: string | null;
	subtitleFileName?: string | null;
	durationSeconds?: number | null;
	sourceWidth?: number | null;
	sourceHeight?: number | null;
	fps?: number | null;
	trimStartSeconds?: number;
	canvasSize?: RoughCutCanvasSize;
	prompt?: string;
	segments?: RoughCutEditSegment[];
	hasAudio?: boolean | null;
	captions?: RoughCutCaption[];
}
