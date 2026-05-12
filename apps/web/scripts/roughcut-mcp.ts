import { startRoughCutMcpServer } from "../src/automation/roughcut/mcp/server";

startRoughCutMcpServer().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
