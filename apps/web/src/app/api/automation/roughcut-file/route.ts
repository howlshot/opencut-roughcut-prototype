import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
	if (process.env.NODE_ENV !== "development") {
		return new Response("Not found", { status: 404 });
	}

	const path = request.nextUrl.searchParams.get("path");
	if (!path) {
		return new Response("Missing path", { status: 400 });
	}

	const metadata = await stat(path).catch(() => null);
	if (!metadata?.isFile()) {
		return new Response("File not found", { status: 404 });
	}

	const data = await readFile(path);
	return new Response(data, {
		headers: {
			"Content-Type": contentTypeForPath({ path }),
			"Content-Disposition": `${contentDispositionForPath({ path })}; filename="${basename(path).replaceAll('"', "")}"`,
		},
	});
}

function contentDispositionForPath({ path }: { path: string }) {
	return path.toLowerCase().endsWith(".zip") ? "attachment" : "inline";
}

function contentTypeForPath({ path }: { path: string }) {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".zip")) {
		return "application/zip";
	}
	if (lowerPath.endsWith(".json")) {
		return "application/json";
	}
	if (lowerPath.endsWith(".mp4")) {
		return "video/mp4";
	}
	if (lowerPath.endsWith(".srt")) {
		return "application/x-subrip; charset=utf-8";
	}
	if (lowerPath.endsWith(".txt")) {
		return "text/plain; charset=utf-8";
	}
	return "application/octet-stream";
}
