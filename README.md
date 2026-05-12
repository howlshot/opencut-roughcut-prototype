# OpenCut Rough-Cut Prototype

Local AI-assisted rough-cut tooling for TikTok, Shorts, and Reels.

This prototype takes a local video file and generates:

- a vertical `1080x1920` MP4 rough cut
- editable `.srt` captions for CapCut
- a transcript JSON
- an intermediate rough-cut JSON
- an optional burned-caption preview

It is built on top of the [OpenCut](https://github.com/OpenCut-app/OpenCut) web app while the automation pipeline is being explored. The current practical workflow is to use this app to generate a CapCut-ready rough cut, then polish the video and captions manually in CapCut.

## Status

This is a working prototype, not a polished product.

What works:

- browser-based local GUI for selecting a video
- FFprobe metadata detection
- FFmpeg silence detection and rough-cut rendering
- local Whisper transcription through `whisper.cpp`
- transcript-aware protection for quiet opening speech
- caption chunking tuned for short-form social videos
- SRT export for CapCut
- optional MCP wrapper for agent workflows

What is intentionally deferred:

- cloud transcription APIs
- Whisper installation automation
- full timeline editor UX
- visual crop/zoom/keyframe decisions
- direct CapCut project generation
- OpenCut renderer/export/WASM changes

## Requirements

- macOS or another local machine with shell access
- [Bun](https://bun.sh/docs/installation)
- [FFmpeg](https://ffmpeg.org/) with `ffmpeg` and `ffprobe` on `PATH`
- `whisper.cpp` CLI on `PATH` as `whisper-cli`
- a local whisper.cpp model, for example:
  - `~/.cache/whisper.cpp/ggml-small.en.bin`
  - `~/.cache/whisper.cpp/ggml-base.en.bin`

On macOS with Homebrew:

```bash
brew install ffmpeg whisper-cpp
```

Download a model using your preferred whisper.cpp model workflow. This prototype currently looks for:

```text
~/.cache/whisper.cpp/ggml-small.en.bin
~/.cache/whisper.cpp/ggml-base.en.bin
```

## Setup

```bash
bun install
bun run roughcut:gui
```

Open:

```text
http://localhost:3000/automation/roughcut-gui
```

## GUI Workflow

1. Choose a local video file.
2. Leave `Cut dead air` enabled.
3. Leave `Trim start` at `0` unless you explicitly want to remove the opening.
4. Keep `Render burned-caption preview` enabled if you want a quick visual timing check.
5. Click `Generate files`.
6. Import these generated files into CapCut:
   - `capcut-clean.mp4`
   - `captions.srt`

The generated files are written under:

```text
~/Downloads/roughcut-gui/
```

## CapCut Import

Use CapCut Desktop or CapCut Web.

1. Create a new CapCut project.
2. Import `capcut-clean.mp4`.
3. Drag the video onto the timeline.
4. Open the captions/subtitles area.
5. Import `captions.srt`.
6. Polish caption wording, timing, style, and edits manually.

CapCut mobile does not reliably support direct SRT import.

## CLI Workflow

Generate rough-cut JSON:

```bash
bun run generate:roughcut --video input.mp4 --auto-silence-cut --auto-transcribe --captions-from-transcript --roughcut-out roughcut.json --transcript-out transcript.json
```

Render a clean MP4:

```bash
bun run render:roughcut --roughcut roughcut.json --out capcut-clean.mp4 --no-captions
```

Render a burned-caption preview:

```bash
bun run render:roughcut --roughcut roughcut.json --out preview-burned-captions.mp4
```

## MCP Server

The prototype includes a thin MCP wrapper around the same rough-cut modules.

```bash
bun run roughcut:mcp
```

See:

```text
docs/automation/opencut-roughcut-mcp.md
```

## Tests

Focused rough-cut tests:

```bash
bun test apps/web/src/automation/roughcut
```

Full upstream OpenCut tests may currently fail on unrelated upstream/local issues. See:

```text
docs/automation/roughcut-known-repo-issues.md
```

## Architecture

Main rough-cut modules:

```text
apps/web/src/automation/roughcut/
apps/web/scripts/roughcut/
apps/web/src/app/automation/roughcut-gui/
apps/web/src/app/api/automation/roughcut-gui/
```

The generated rough-cut JSON is an intermediate format, not a stable public OpenCut project format. The practical handoff format today is:

- MP4 for video
- SRT for editable captions

## Attribution

This repo is based on OpenCut, an MIT-licensed open-source video editor:

```text
https://github.com/OpenCut-app/OpenCut
```

OpenCut license terms remain in `LICENSE`.
