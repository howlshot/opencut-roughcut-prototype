import type { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import type { SubtitleStyleOverrides } from "@/subtitles/types";
import { mediaTimeFromSeconds, type MediaTime } from "@/wasm";
import type {
	RoughCutCaption,
	RoughCutClip,
	RoughCutDocument,
	RoughCutMediaItem,
} from "./types";

export type RoughCutMediaFiles = Map<string, File> | Record<string, File>;

export interface ImportRoughCutResult {
	projectId: string;
	importedMediaIds: Record<string, string>;
	insertedClipCount: number;
	insertedCaptionCount: number;
	captionTrackId: string | null;
	warnings: string[];
}

export async function importRoughCutToOpenCut({
	editor,
	roughCut,
	files,
}: {
	editor: EditorCore;
	roughCut: RoughCutDocument;
	files: RoughCutMediaFiles;
}): Promise<ImportRoughCutResult> {
	validateRoughCutForImport({ roughCut });

	const projectId = await editor.project.createNewProject({
		name: roughCut.project.name,
	});
	const warnings: string[] = [];

	await editor.project.updateSettings({
		settings: {
			canvasSize: roughCut.project.canvasSize,
			canvasSizeMode: "preset",
			background: roughCut.project.background,
			fps: roughCut.project.fps,
		},
		pushHistory: false,
	});

	const importedMedia = await importMedia({
		editor,
		projectId,
		roughCut,
		files,
		warnings,
	});

	let insertedClipCount = 0;
	for (const clip of roughCut.clips) {
		const imported = importedMedia.get(clip.mediaId);
		if (!imported) {
			warnings.push(
				`Skipped clip ${clip.id}: media ${clip.mediaId} was not imported.`,
			);
			continue;
		}

		insertClip({
			editor,
			clip,
			media: imported.media,
			source: imported.source,
		});
		insertedClipCount += 1;
	}

	// InsertElementCommand auto-fits the canvas to the first visual asset. Restore
	// the automation target after clips are on the timeline.
	await editor.project.updateSettings({
		settings: {
			canvasSize: roughCut.project.canvasSize,
			canvasSizeMode: "preset",
			background: roughCut.project.background,
			fps: roughCut.project.fps,
		},
		pushHistory: false,
	});

	const captionTrackId = insertCaptions({
		editor,
		captions: roughCut.captions,
	});

	await editor.project.saveCurrentProject();

	return {
		projectId,
		importedMediaIds: Object.fromEntries(
			Array.from(importedMedia.entries()).map(([externalId, imported]) => [
				externalId,
				imported.media.id,
			]),
		),
		insertedClipCount,
		insertedCaptionCount: roughCut.captions.length,
		captionTrackId,
		warnings,
	};
}

async function importMedia({
	editor,
	projectId,
	roughCut,
	files,
	warnings,
}: {
	editor: EditorCore;
	projectId: string;
	roughCut: RoughCutDocument;
	files: RoughCutMediaFiles;
	warnings: string[];
}): Promise<Map<string, { media: MediaAsset; source: RoughCutMediaItem }>> {
	const imported = new Map<
		string,
		{ media: MediaAsset; source: RoughCutMediaItem }
	>();

	for (const source of roughCut.media) {
		const file = getFileForMediaId({ files, mediaId: source.id });
		if (!file) {
			warnings.push(`Skipped media ${source.id}: no File object was provided.`);
			continue;
		}

		const [processed] = await processMediaAssets({ files: [file] });
		if (!processed) {
			warnings.push(
				`Skipped media ${source.id}: OpenCut could not process ${file.name}.`,
			);
			continue;
		}

		const saved = await editor.media.addMediaAsset({
			projectId,
			asset: {
				...processed,
				name: source.name || processed.name,
				type: source.type,
				duration: source.durationSeconds ?? processed.duration,
				width: source.width ?? processed.width,
				height: source.height ?? processed.height,
				fps: source.fps ?? processed.fps,
				hasAudio: source.hasAudio ?? processed.hasAudio,
			},
		});
		if (!saved) {
			warnings.push(
				`Skipped media ${source.id}: OpenCut could not save ${file.name}.`,
			);
			continue;
		}

		imported.set(source.id, { media: saved, source });
	}

	return imported;
}

function insertClip({
	editor,
	clip,
	media,
	source,
}: {
	editor: EditorCore;
	clip: RoughCutClip;
	media: MediaAsset;
	source: RoughCutMediaItem;
}): void {
	if (clip.type !== "video") {
		throw new Error(
			`Rough cut importer v1 only inserts video clips; got ${clip.type}`,
		);
	}

	const duration = secondsToMediaTime({ seconds: clip.durationSeconds });
	const trimStart = secondsToMediaTime({ seconds: clip.sourceStartSeconds });
	const timelineStart = secondsToMediaTime({
		seconds: clip.timelineStartSeconds,
	});
	const sourceDurationSeconds =
		source.durationSeconds ??
		media.duration ??
		clip.sourceStartSeconds + clip.durationSeconds;
	const sourceDuration = secondsToMediaTime({ seconds: sourceDurationSeconds });
	const trimEnd = secondsToMediaTime({
		seconds: Math.max(
			0,
			sourceDurationSeconds - clip.sourceStartSeconds - clip.durationSeconds,
		),
	});

	const element = buildElementFromMedia({
		mediaId: media.id,
		mediaType: media.type,
		name: media.name,
		duration,
		startTime: timelineStart,
	});

	if (element.type !== "video") {
		throw new Error(
			`Media ${clip.mediaId} did not resolve to a video element.`,
		);
	}

	editor.timeline.insertElement({
		element: {
			...element,
			duration,
			trimStart,
			trimEnd,
			sourceDuration,
			params: {
				...element.params,
				...clip.params,
			},
		},
		placement: {
			mode: "explicit",
			trackId: editor.scenes.getActiveScene().tracks.main.id,
		},
	});
}

function insertCaptions({
	editor,
	captions,
}: {
	editor: EditorCore;
	captions: RoughCutCaption[];
}): string | null {
	if (captions.length === 0) {
		return null;
	}

	return insertCaptionChunksAsTextTrack({
		editor,
		captions: captions.map((caption) => ({
			text: caption.text,
			startTime: caption.startTimeSeconds,
			duration: caption.durationSeconds,
			style: toSubtitleStyle({ caption }),
		})),
	});
}

function toSubtitleStyle({
	caption,
}: {
	caption: RoughCutCaption;
}): SubtitleStyleOverrides | undefined {
	const style = caption.style;
	if (!style) {
		return undefined;
	}

	const { background, ...rest } = style;
	return {
		...rest,
		...(background
			? {
					background: {
						...background,
						enabled: background.enabled ?? false,
						color: background.color ?? "#000000",
					},
				}
			: {}),
	};
}

function getFileForMediaId({
	files,
	mediaId,
}: {
	files: RoughCutMediaFiles;
	mediaId: string;
}): File | null {
	if (files instanceof Map) {
		return files.get(mediaId) ?? null;
	}
	return files[mediaId] ?? null;
}

function secondsToMediaTime({ seconds }: { seconds: number }): MediaTime {
	if (!Number.isFinite(seconds) || seconds < 0) {
		throw new Error(
			`Expected a non-negative finite second value, got ${seconds}`,
		);
	}
	return mediaTimeFromSeconds({ seconds });
}

function validateRoughCutForImport({
	roughCut,
}: {
	roughCut: RoughCutDocument;
}): void {
	if (roughCut.schema !== "opencut-roughcut-v1") {
		throw new Error(`Unsupported rough cut schema: ${roughCut.schema}`);
	}
	if (roughCut.media.length === 0) {
		throw new Error("Rough cut must include at least one media item.");
	}
	if (roughCut.clips.length === 0) {
		throw new Error("Rough cut must include at least one clip.");
	}
}
