import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRoughCutMcpHandlers } from "./handlers";
import {
	detectSilenceInputShape,
	detectSilenceOutputShape,
	explainRoughCutInputShape,
	explainRoughCutOutputShape,
	generateRoughCutInputShape,
	generateRoughCutOutputShape,
	probeVideoInputShape,
	probeVideoOutputShape,
	transcribeVideoInputShape,
	transcribeVideoOutputShape,
} from "./schemas";

const SERVER_VERSION = "0.1.0";

export function createRoughCutMcpServer() {
	const handlers = createRoughCutMcpHandlers();
	const server = new McpServer({
		name: "opencut-roughcut",
		version: SERVER_VERSION,
	});

	server.registerTool(
		"probe_video",
		{
			title: "Probe Video",
			description:
				"Read local video metadata with ffprobe and suggest whether a vertical 9:16 rough cut needs crop/framing work.",
			inputSchema: probeVideoInputShape,
			outputSchema: probeVideoOutputShape,
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (input) => asToolResult({ ...(await handlers.probeVideo(input)) }),
	);

	server.registerTool(
		"detect_silence",
		{
			title: "Detect Silence",
			description:
				"Run FFmpeg silencedetect and convert detected silence ranges into suggested speech keep segments.",
			inputSchema: detectSilenceInputShape,
			outputSchema: detectSilenceOutputShape,
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (input) => asToolResult({ ...(await handlers.detectSilence(input)) }),
	);

	server.registerTool(
		"transcribe_video",
		{
			title: "Transcribe Video",
			description:
				"Transcribe a local video with a supported local Whisper CLI and optionally write transcript JSON.",
			inputSchema: transcribeVideoInputShape,
			outputSchema: transcribeVideoOutputShape,
			annotations: { readOnlyHint: false, openWorldHint: false },
		},
		async (input) =>
			asToolResult({ ...(await handlers.transcribeVideo(input)) }),
	);

	server.registerTool(
		"generate_roughcut",
		{
			title: "Generate Rough Cut",
			description:
				"Generate an OpenCut rough-cut JSON from a local video using optional silence cuts and local transcription.",
			inputSchema: generateRoughCutInputShape,
			outputSchema: generateRoughCutOutputShape,
			annotations: { readOnlyHint: false, openWorldHint: false },
		},
		async (input) =>
			asToolResult({ ...(await handlers.generateRoughCut(input)) }),
	);

	server.registerTool(
		"explain_roughcut",
		{
			title: "Explain Rough Cut",
			description:
				"Read an OpenCut rough-cut JSON file and summarize project settings, clips, captions, edit decisions, and limitations.",
			inputSchema: explainRoughCutInputShape,
			outputSchema: explainRoughCutOutputShape,
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (input) =>
			asToolResult({ ...(await handlers.explainRoughCut(input)) }),
	);

	return server;
}

export async function startRoughCutMcpServer() {
	const server = createRoughCutMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("OpenCut rough-cut MCP server running on stdio.");
}

function asToolResult(structuredContent: Record<string, unknown>) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(structuredContent, null, 2),
			},
		],
		structuredContent,
	};
}
