import { ROUGHCUT_SCHEMA_VERSION } from "./types";
import type {
	GenerateRoughCutOptions,
	RoughCutCaption,
	RoughCutClip,
	RoughCutDocument,
	RoughCutEditSegment,
	RoughCutParamValues,
} from "./types";
import { parseRoughCutSubtitleFile } from "./subtitles";
import { remapCaptionsToSegments } from "./silence";

const DEFAULT_DURATION_SECONDS = 30;
const DEFAULT_TRIM_START_SECONDS = 2;
const DEFAULT_CANVAS_SIZE = { width: 1080, height: 1920 };
const DEFAULT_FPS = { numerator: 30, denominator: 1 };

const DEFAULT_VIDEO_PARAMS: RoughCutParamValues = {
	"transform.positionX": 0,
	"transform.positionY": 0,
	"transform.scaleX": 1,
	"transform.scaleY": 1,
	"transform.rotate": 0,
	opacity: 1,
	blendMode: "normal",
	volume: 0,
	muted: false,
};

const DEFAULT_CAPTION_STYLE = {
	fontFamily: "Arial",
	fontSize: 7,
	color: "#ffffff",
	fontWeight: "bold" as const,
	textAlign: "center" as const,
	placement: {
		verticalAlign: "bottom" as const,
		marginVerticalRatio: 0.08,
	},
};

export function generateRoughCutDocument({
	videoPath,
	projectName,
	subtitleInput,
	subtitleFileName,
	durationSeconds,
	sourceWidth,
	sourceHeight,
	fps,
	trimStartSeconds = DEFAULT_TRIM_START_SECONDS,
	canvasSize = DEFAULT_CANVAS_SIZE,
	prompt = "Take input.mp4, make it vertical 9:16, remove dead air, trim the first 2 seconds, add punchy subtitles, and prepare a TikTok-ready rough cut.",
	segments,
	hasAudio,
	captions: providedCaptions,
}: GenerateRoughCutOptions): RoughCutDocument {
	const inputDurationSeconds = durationSeconds ?? DEFAULT_DURATION_SECONDS;
	const clipDurationSeconds = Math.max(
		0,
		inputDurationSeconds - trimStartSeconds,
	);
	const editSegments =
		segments && segments.length > 0
			? segments
			: [
					{
						sourceStartSeconds: trimStartSeconds,
						sourceEndSeconds: trimStartSeconds + clipDurationSeconds,
						timelineStartSeconds: 0,
						timelineEndSeconds: clipDurationSeconds,
						reason: "manual" as const,
					},
				];
	const rawCaptions =
		providedCaptions ??
		buildCaptions({
			subtitleInput,
			subtitleFileName,
			clipDurationSeconds,
		});
	const captions =
		segments &&
		segments.length > 0 &&
		!providedCaptions &&
		subtitleInput &&
		subtitleFileName
			? remapCaptionsToSegments({ captions: rawCaptions, segments })
			: rawCaptions;

	return {
		schema: ROUGHCUT_SCHEMA_VERSION,
		project: {
			name: projectName,
			canvasSize,
			fps: fps ? { numerator: Math.round(fps), denominator: 1 } : DEFAULT_FPS,
			background: { type: "color", color: "#000000" },
		},
		media: [
			{
				id: "media-input",
				path: videoPath,
				type: "video",
				name: getBaseName({ path: videoPath }),
				durationSeconds: durationSeconds ?? null,
				width: sourceWidth ?? null,
				height: sourceHeight ?? null,
				fps: fps ?? null,
				hasAudio: hasAudio ?? null,
			},
		],
		clips: buildClipsFromSegments({ segments: editSegments }),
		captions,
		...(segments && segments.length > 0
			? {
					segments,
					editDecisionList: {
						segments,
						source: "silence-detect" as const,
						notes: [
							"Generated from FFmpeg silencedetect output with speech padding.",
						],
					},
				}
			: {}),
		metadata: {
			prompt,
			generator: "OpenCut roughcut prototype",
			createdAt: new Date().toISOString(),
			notes: [
				"Intermediate automation format; import through the OpenCut rough-cut importer rather than treating this as a native project file.",
				segments && segments.length > 0
					? "Silence removal is represented as edit-decision segments and multiple timeline clips."
					: "Silence removal was not requested. This rough cut only applies the requested leading trim.",
			],
		},
	};
}

function getBaseName({ path }: { path: string }): string {
	const normalized = path.replace(/\\/g, "/");
	return normalized.split("/").filter(Boolean).pop() ?? path;
}

function buildCaptions({
	subtitleInput,
	subtitleFileName,
	clipDurationSeconds,
}: {
	subtitleInput?: string | null;
	subtitleFileName?: string | null;
	clipDurationSeconds: number;
}): RoughCutCaption[] {
	if (subtitleInput && subtitleFileName) {
		const result = parseRoughCutSubtitleFile({
			fileName: subtitleFileName,
			input: subtitleInput,
		});
		return result.captions.map((caption) => ({
			...caption,
			style: DEFAULT_CAPTION_STYLE,
		}));
	}

	return [
		{
			text: "MAKE IT PUNCHY",
			startTimeSeconds: Math.min(0.3, clipDurationSeconds),
			durationSeconds: Math.min(0.9, Math.max(0.1, clipDurationSeconds)),
			style: DEFAULT_CAPTION_STYLE,
		},
	];
}

function buildClipsFromSegments({
	segments,
}: {
	segments: RoughCutEditSegment[];
}): RoughCutClip[] {
	return segments.map((segment, index) => ({
		id: `clip-${index + 1}`,
		mediaId: "media-input",
		type: "video",
		timelineStartSeconds: segment.timelineStartSeconds,
		sourceStartSeconds: segment.sourceStartSeconds,
		durationSeconds: segment.sourceEndSeconds - segment.sourceStartSeconds,
		params: DEFAULT_VIDEO_PARAMS,
		cropZoomKeyframes: [],
	}));
}
