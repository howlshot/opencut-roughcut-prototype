# OpenCut Rough-Cut Automation Prototype

This document describes the prototype automation path for AI-assisted TikTok or
Shorts rough cuts without depending on OpenCut's export/rendering internals.

## Architecture Notes

OpenCut's active editor is the Next/React app in `apps/web`. The desktop GPUI
app is currently a placeholder window. The editor state is owned by the
`EditorCore` singleton and its managers:

- `ProjectManager` creates, loads, saves, and updates project settings.
- `ScenesManager` owns the active scene list and track state.
- `TimelineManager` inserts and updates clips through command objects.
- `MediaManager` stores imported media assets.

Local project storage is browser-based:

- Project JSON is stored in IndexedDB database `video-editor-projects`, store
  `projects`.
- Media metadata is stored in IndexedDB database
  `video-editor-media-${projectId}`, store `media-metadata`.
- Media files are stored in OPFS under `media-files-${projectId}`.

Drizzle/Postgres is used for auth/feedback and is not part of local project
timeline storage.

## Data Model Notes

The current native project version is `31`. A project contains metadata,
settings, scenes, the current scene id, version, and optional timeline view
state. A scene contains `tracks: { overlay, main, audio }`; the main track is a
video track and captions are text elements on an overlay text track.

Timeline times are integer media ticks. `1 second = 120000` ticks. The rough-cut
format intentionally stores seconds and lets the OpenCut importer convert to
ticks through `mediaTimeFromSeconds`.

The existing subtitle UI imports SRT/ASS and converts captions into text
elements. This prototype's JSON generator supports SRT/VTT for the intermediate
format, while the OpenCut-side importer converts rough-cut captions into the
same caption/text element path.

## Recommended Automation Path

Use `opencut-roughcut-v1.json` as an intermediate MCP-friendly format:

1. Generate the rough-cut JSON outside the browser.
2. Open OpenCut and hand the JSON plus actual browser `File` objects to
   `importRoughCutToOpenCut`.
3. Let OpenCut save project JSON, media metadata, and media files through its
   existing storage services.

This avoids treating native OpenCut project JSON as a stable public API and
keeps media OPFS writes inside the browser context.

## Prototype CLI

### Required local dependencies

The baseline JSON generator does not require FFmpeg or Whisper. The
`--auto-silence-cut` path requires local `ffprobe` and `ffmpeg` binaries on
`PATH`; they are not bundled with OpenCut.

The `--auto-transcribe` path requires one local transcription CLI:

- Preferred: whisper.cpp with `whisper-cli` on `PATH`, or `WHISPERCPP_BIN`
  pointing to the executable. Pass a local model file with
  `--transcription-model`.
- Fallback: OpenAI Whisper Python CLI with `whisper` on `PATH`. Install with
  `pip install openai-whisper` and pass a model name such as `base`, `small`,
  or `medium` with `--transcription-model`.

No cloud transcription APIs are used by this prototype.

Generate a rough-cut JSON file:

```bash
bun generate:roughcut --video input.mp4 --duration-seconds 30 --out opencut-roughcut-v1.json
```

With captions:

```bash
bun generate:roughcut --video input.mp4 --subtitles captions.srt --duration-seconds 30
```

With local metadata probing and silence-cut segments:

```bash
bun generate:roughcut \
  --video input.mp4 \
  --subtitles captions.vtt \
  --auto-silence-cut \
  --silence-threshold -35dB \
  --min-silence-duration 0.35 \
  --out roughcut.json
```

With local transcription and TikTok-style captions:

```bash
bun generate:roughcut \
  --video input.mp4 \
  --auto-transcribe \
  --transcription-provider auto \
  --transcription-model small \
  --captions-from-transcript \
  --caption-style tiktok \
  --out roughcut.json
```

With whisper.cpp:

```bash
bun generate:roughcut \
  --video input.mp4 \
  --auto-transcribe \
  --transcription-provider whispercpp \
  --transcription-model /path/to/ggml-base.en.bin \
  --captions-from-transcript \
  --out roughcut.json
```

Write both intermediate outputs:

```bash
bun generate:roughcut \
  --video input.mp4 \
  --auto-silence-cut \
  --auto-transcribe \
  --transcript-out transcript.json \
  --roughcut-out roughcut.json
```

Write only transcript JSON:

```bash
bun generate:roughcut \
  --video input.mp4 \
  --auto-transcribe \
  --transcript-out transcript.json
```

When `--auto-silence-cut` is not passed, behavior remains the original Phase 1
path: one clip, vertical 1080x1920 project settings, leading trim, caption
records, and placeholder keyframe slots.

When `--auto-silence-cut` is passed, the CLI:

- reads duration, dimensions, FPS, and audio presence with `ffprobe`,
- reads silence ranges with FFmpeg `silencedetect`,
- converts silence ranges into padded speech keep segments,
- emits multiple OpenCut clips from those segments,
- includes optional `segments` and `editDecisionList.segments` fields.

The rough-cut JSON remains importable by the browser-side importer because clips
are still fully materialized in the `clips` array.

## Edit Segments

Phase 2 adds optional edit-decision fields while preserving backward
compatibility with Phase 1 JSON:

```json
{
	"segments": [
		{
			"sourceStartSeconds": 2,
			"sourceEndSeconds": 5.25,
			"timelineStartSeconds": 0,
			"timelineEndSeconds": 3.25,
			"reason": "speech"
		}
	],
	"editDecisionList": {
		"source": "silence-detect",
		"segments": []
	}
}
```

Segment `reason` can be `"speech"`, `"manual"`, `"ai"`, or `"unknown"`. Future
AI edit decisions should add segments first, then let the generator materialize
clips.

## Captions and Timing

SRT and VTT captions are treated as source-video timings. When silence cuts are
enabled, captions are remapped onto the edited timeline by intersecting each
caption with the keep segments. Captions that cross a cut may be split into
multiple caption elements with the same text. Captions that fall entirely inside
removed silence are dropped.

If no subtitle file is supplied, the prototype placeholder caption remains a
timeline caption and is not source-remapped.

When `--auto-transcribe` is enabled, the CLI can convert transcript segments
into rough-cut captions. The converter keeps chunks short for vertical short
form video, defaults to six words per caption and 2.5 seconds maximum duration,
and supports `tiktok`, `clean`, and `minimal` style presets. If silence cuts are
also enabled, transcript captions are source-timed first and then remapped onto
the edited timeline. Captions fully inside removed sections are dropped;
captions crossing a cut are clipped or split by segment intersection.

If both `--subtitles` and `--auto-transcribe` are provided, subtitle captions
remain preferred unless `--captions-from-transcript` is passed.

## Importer API

`importRoughCutToOpenCut` lives in `apps/web/src/automation/roughcut`.

```ts
await importRoughCutToOpenCut({
	editor,
	roughCut,
	files: {
		"media-input": inputFile,
	},
});
```

The importer:

- creates a new OpenCut project,
- processes and saves the provided media `File` objects,
- inserts video clips with `trimStart`, `duration`, and `sourceDuration`,
- restores the requested 1080x1920 canvas after clip insertion,
- inserts captions as text elements,
- saves the project through `ProjectManager`.

## Sample JSON

```json
{
	"schema": "opencut-roughcut-v1",
	"project": {
		"name": "TikTok rough cut",
		"canvasSize": { "width": 1080, "height": 1920 },
		"fps": { "numerator": 30, "denominator": 1 },
		"background": { "type": "color", "color": "#000000" }
	},
	"media": [
		{
			"id": "media-input",
			"path": "input.mp4",
			"type": "video",
			"name": "input.mp4",
			"durationSeconds": 30,
			"width": null,
			"height": null,
			"fps": null,
			"hasAudio": null
		}
	],
	"clips": [
		{
			"id": "clip-1",
			"mediaId": "media-input",
			"type": "video",
			"timelineStartSeconds": 0,
			"sourceStartSeconds": 2,
			"durationSeconds": 28,
			"params": {
				"transform.positionX": 0,
				"transform.positionY": 0,
				"transform.scaleX": 1,
				"transform.scaleY": 1,
				"transform.rotate": 0,
				"opacity": 1,
				"blendMode": "normal",
				"volume": 0,
				"muted": false
			},
			"cropZoomKeyframes": []
		}
	],
	"captions": [
		{
			"text": "MAKE IT PUNCHY",
			"startTimeSeconds": 0.3,
			"durationSeconds": 0.9,
			"style": {
				"fontFamily": "Arial",
				"fontSize": 7,
				"color": "#ffffff",
				"fontWeight": "bold",
				"textAlign": "center",
				"placement": {
					"verticalAlign": "bottom",
					"marginVerticalRatio": 0.08
				}
			}
		}
	]
}
```

## Do Not Touch Yet

Avoid renderer/export internals, WASM compositor code, cloud transcription
APIs, media transcoding beyond temporary audio extraction for whisper.cpp, and
any claim that native OpenCut project JSON is a stable file format.

## Current Limitations

- Silence detection depends on local FFmpeg binaries and does not bundle them.
- Local transcription depends on the user installing whisper.cpp or
  openai-whisper. Tests mock transcript data and do not require either tool.
- Silence cuts are audio-only heuristics; there is no semantic AI edit planner
  yet.
- whisper.cpp currently requires FFmpeg to extract temporary 16 kHz mono WAV
  audio before transcription.
- Transcript captions are segment-level or word-level depending on CLI output.
  If a provider omits word timings, timings are interpolated evenly across each
  segment.
- The CLI does not export video. It only creates an OpenCut-importable rough-cut
  JSON.
- Auto crop/zoom/keyframes are placeholders only.

## Next MCP Tools

Phase 4 adds a local stdio MCP wrapper documented in
`docs/automation/opencut-roughcut-mcp.md`.

- `probe_video`: return metadata and vertical-format suggestions.
- `detect_silence`: return FFmpeg silence ranges and keep segments.
- `transcribe_video`: wrap local Whisper CLI transcription.
- `generate_roughcut`: produce `opencut-roughcut-v1.json`.
- `explain_roughcut`: summarize an existing rough-cut JSON.
- `import_to_opencut`: still deferred to the browser context because media
  files live in browser OPFS.
- `export_rough_cut`: defer until OpenCut export stabilizes.

## Phase 3 Plan

Recommended local workflow:

1. Generate a rough cut with silence detection.
2. Auto-transcribe locally and generate captions.
3. Import the rough-cut JSON and media file into OpenCut.
4. Polish cuts, captions, crop, and pacing manually in the editor.

Next Phase 3 follow-up work:

- Add an AI edit-decision layer that can create `"ai"` segments and crop/zoom
  keyframe placeholders without changing OpenCut storage internals.
- Add UI affordances for pairing rough-cut media IDs with selected browser
  `File` objects.
- Add optional word-level parsing improvements for provider-specific JSON
  formats as needed.
- Keep export as a later integration point after OpenCut's rendering/export
  refactor settles.
