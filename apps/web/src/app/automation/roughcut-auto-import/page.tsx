"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EditorCore } from "@/core";
import {
	importRoughCutToOpenCut,
	type RoughCutDocument,
} from "@/automation/roughcut";

export default function RoughCutAutoImportPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [status, setStatus] = useState("Preparing rough-cut import...");
	const [error, setError] = useState<string | null>(null);
	const paths = useMemo(
		() => ({
			jsonPath: searchParams.get("jsonPath") ?? "",
			videoPath: searchParams.get("videoPath") ?? "",
		}),
		[searchParams],
	);

	useEffect(() => {
		let cancelled = false;

		const runImport = async () => {
			try {
				if (!paths.jsonPath || !paths.videoPath) {
					throw new Error(
						"Pass jsonPath and videoPath query parameters to auto-import a rough cut.",
					);
				}

				setStatus("Loading rough-cut JSON...");
				const roughCut = await fetchJson({ path: paths.jsonPath });
				const mediaId = roughCut.media[0]?.id;
				if (!mediaId) {
					throw new Error("Rough-cut JSON has no media item.");
				}

				setStatus("Loading source video...");
				const videoFile = await fetchFile({
					path: paths.videoPath,
					type: "video/mp4",
				});

				setStatus("Creating OpenCut project...");
				const result = await importRoughCutToOpenCut({
					editor: EditorCore.getInstance(),
					roughCut,
					files: { [mediaId]: videoFile },
				});

				if (cancelled) {
					return;
				}

				setStatus(
					`Imported ${result.insertedClipCount} clip(s). Opening editor...`,
				);
				router.replace(`/editor/${result.projectId}`);
			} catch (importError) {
				if (cancelled) {
					return;
				}
				setError(
					importError instanceof Error
						? importError.message
						: "Failed to import rough cut.",
				);
			}
		};

		runImport();
		return () => {
			cancelled = true;
		};
	}, [paths, router]);

	return (
		<main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
			<div className="flex max-w-xl flex-col gap-3">
				<h1 className="text-2xl font-semibold">Importing rough cut</h1>
				<p className="text-muted-foreground text-sm">{status}</p>
				{error ? <p className="text-destructive text-sm">{error}</p> : null}
				<div className="text-muted-foreground text-xs">
					<p>JSON: {paths.jsonPath}</p>
					<p>Video: {paths.videoPath}</p>
				</div>
			</div>
		</main>
	);
}

async function fetchJson({
	path,
}: {
	path: string;
}): Promise<RoughCutDocument> {
	const response = await fetch(fileApiUrl({ path }));
	if (!response.ok) {
		throw new Error(`Could not load rough-cut JSON: ${response.status}`);
	}
	return (await response.json()) as RoughCutDocument;
}

async function fetchFile({
	path,
	type,
}: {
	path: string;
	type: string;
}): Promise<File> {
	const response = await fetch(fileApiUrl({ path }));
	if (!response.ok) {
		throw new Error(`Could not load source video: ${response.status}`);
	}
	const blob = await response.blob();
	return new File([blob], path.split("/").pop() ?? "input.mp4", { type });
}

function fileApiUrl({ path }: { path: string }) {
	return `/api/automation/roughcut-file?path=${encodeURIComponent(path)}`;
}
