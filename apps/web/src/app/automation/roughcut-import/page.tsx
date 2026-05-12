"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditorCore } from "@/core";
import {
	importRoughCutToOpenCut,
	type RoughCutDocument,
} from "@/automation/roughcut";

export default function RoughCutImportPage() {
	const router = useRouter();
	const [roughCutFile, setRoughCutFile] = useState<File | null>(null);
	const [mediaFile, setMediaFile] = useState<File | null>(null);
	const [isImporting, setIsImporting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const importRoughCut = async () => {
		if (!roughCutFile || !mediaFile) {
			setError("Choose both the rough-cut JSON and source video file.");
			return;
		}

		setIsImporting(true);
		setError(null);
		setMessage("Importing rough cut...");

		try {
			const roughCut = JSON.parse(
				await roughCutFile.text(),
			) as RoughCutDocument;
			const mediaId = roughCut.media[0]?.id;
			if (!mediaId) {
				throw new Error("Rough-cut JSON has no media item to attach.");
			}

			const result = await importRoughCutToOpenCut({
				editor: EditorCore.getInstance(),
				roughCut,
				files: { [mediaId]: mediaFile },
			});

			const warningText =
				result.warnings.length > 0
					? ` Imported with warnings: ${result.warnings.join(" ")}`
					: "";
			setMessage(
				`Imported ${result.insertedClipCount} clip(s) and ${result.insertedCaptionCount} caption(s).${warningText}`,
			);
			router.push(`/editor/${result.projectId}`);
		} catch (importError) {
			setError(
				importError instanceof Error
					? importError.message
					: "Failed to import rough cut.",
			);
			setMessage(null);
		} finally {
			setIsImporting(false);
		}
	};

	return (
		<main className="bg-background text-foreground min-h-screen px-6 py-8">
			<div className="mx-auto flex max-w-2xl flex-col gap-6">
				<div>
					<h1 className="text-2xl font-semibold">OpenCut rough-cut import</h1>
					<p className="text-muted-foreground mt-2 text-sm">
						Load an `opencut-roughcut-v1` JSON file and its source media into a
						new local OpenCut project.
					</p>
				</div>

				<label className="flex flex-col gap-2 text-sm">
					<span className="font-medium">Rough-cut JSON</span>
					<input
						type="file"
						accept="application/json,.json"
						onChange={(event) =>
							setRoughCutFile(event.currentTarget.files?.[0] ?? null)
						}
					/>
				</label>

				<label className="flex flex-col gap-2 text-sm">
					<span className="font-medium">Source video</span>
					<input
						type="file"
						accept="video/*"
						onChange={(event) =>
							setMediaFile(event.currentTarget.files?.[0] ?? null)
						}
					/>
				</label>

				<div className="flex items-center gap-3">
					<button
						type="button"
						disabled={isImporting}
						onClick={importRoughCut}
						className="bg-primary text-primary-foreground disabled:opacity-50 rounded-md px-4 py-2 text-sm font-medium"
					>
						{isImporting ? "Importing..." : "Import and preview"}
					</button>
					{message ? (
						<p className="text-muted-foreground text-sm">{message}</p>
					) : null}
				</div>

				{error ? <p className="text-destructive text-sm">{error}</p> : null}
			</div>
		</main>
	);
}
