# OpenCut Rough-Cut MCP Server

This is a thin local MCP wrapper around the rough-cut automation prototype. It
does not export/render video and does not write native OpenCut project files.
It produces or explains `opencut-roughcut-v1` JSON for the browser-side OpenCut
importer.

## Run Locally

From the OpenCut repo root:

```bash
bun roughcut:mcp
```

The server uses stdio, which is the common local MCP transport for desktop
clients. Tool execution can call local `ffprobe`, `ffmpeg`, `whisper-cli`, or
`whisper` depending on the requested operation.

Focused rough-cut/MCP tests currently pass. The full repo test suite currently
fails on unrelated upstream issues in WASM initialization, timeline media-time
constant initialization, and action/keybinding exports; see
`docs/automation/roughcut-known-repo-issues.md`.

## Local Dependencies

- `probe_video`: requires `ffprobe`.
- `detect_silence`: requires `ffprobe` and `ffmpeg`.
- `transcribe_video`: requires `whisper.cpp` (`whisper-cli`) or
  `openai-whisper` (`whisper`).
- `generate_roughcut`: requires the dependencies for the options you enable.

FFmpeg and Whisper are not bundled with OpenCut. No cloud APIs are used.

## Claude Desktop Configuration

Add a server entry similar to this, replacing the repo path with your local
checkout:

```json
{
	"mcpServers": {
		"opencut-roughcut": {
			"command": "bun",
			"args": [
				"/Users/david/Documents/New project/OpenCut/apps/web/scripts/roughcut-mcp.ts"
			],
			"cwd": "/Users/david/Documents/New project/OpenCut"
		}
	}
}
```

Compatible MCP clients can use the same command, args, and cwd values.

## Tools

### `probe_video`

Input:

```json
{ "videoPath": "/absolute/path/input.mp4" }
```

Output includes duration, width, height, fps, audio presence, and a simple
vertical 9:16 crop/framing suggestion.

### `detect_silence`

Input:

```json
{
	"videoPath": "/absolute/path/input.mp4",
	"silenceThreshold": "-35dB",
	"minSilenceDuration": 0.35
}
```

Output includes FFmpeg silence ranges and suggested speech keep segments.

### `transcribe_video`

Input:

```json
{
	"videoPath": "/absolute/path/input.mp4",
	"provider": "auto",
	"model": "small",
	"transcriptOut": "/absolute/path/transcript.json"
}
```

Output includes transcript segments, the transcript path if written, and the
provider used.

### `generate_roughcut`

Input:

```json
{
	"videoPath": "/absolute/path/input.mp4",
	"roughcutOut": "/absolute/path/roughcut.json",
	"autoSilenceCut": true,
	"autoTranscribe": true,
	"transcriptionProvider": "auto",
	"transcriptionModel": "small",
	"captionStyle": "tiktok",
	"silenceThreshold": "-35dB",
	"minSilenceDuration": 0.35,
	"promptNotes": "Cut dead air, keep it fast, use punchy captions."
}
```

When transcription is enabled, the tool also writes a transcript beside the
rough cut using the suffix `.transcript.json`, for example
`roughcut.transcript.json`.

### `explain_roughcut`

Input:

```json
{ "roughcutJsonPath": "/absolute/path/roughcut.json" }
```

Output is a human-readable summary of project settings, clips, captions, edit
decision list entries, and warnings/limitations.

## Example Agent Prompts

- "Probe this clip and make me a TikTok rough cut with punchy captions."
- "Cut dead air, keep it fast, use TikTok captions, and output OpenCut JSON."
- "Transcribe this clip locally, then generate an OpenCut rough cut from the
  transcript."
- "Explain what edits were made in this rough-cut JSON."

## Limitations

- The server only wraps the existing local rough-cut automation.
- It does not launch OpenCut or import media into browser OPFS.
- It does not render or export video.
- Silence detection is audio-threshold based and not semantic editing.
- Transcription depends on local CLI tools and model availability.
