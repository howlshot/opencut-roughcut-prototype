"use client";

import { useMemo, useState } from "react";

type FileLink = { path: string; url: string };

interface GuiResult {
	outputDir: string;
	summary: {
		clipCount: number;
		captionCount: number;
		originalDuration: number;
		editedDuration: number;
		removedDuration: number;
	};
	files: {
		cleanVideo: FileLink;
		captions: FileLink;
		roughcut: FileLink;
		transcript: FileLink | null;
		previewVideo: FileLink | null;
	};
}

const DEFAULT_PROMPT =
	"Canyon Ranch, Dr. Jen Wagner, Dr. Sadio Lucio, wellness, Botox, ice baths, morning routine, stretching, protein coffee, mindset, positive affirmations, sleep, midlife women, strength training.";

export default function RoughCutGuiPage() {
	const [videoFile, setVideoFile] = useState<File | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<GuiResult | null>(null);
	const [renderPreview, setRenderPreview] = useState(true);
	const [autoSilenceCut, setAutoSilenceCut] = useState(true);
	const [trimStartSeconds, setTrimStartSeconds] = useState("0");
	const [captionOffsetSeconds, setCaptionOffsetSeconds] = useState("-0.25");
	const [maxWordsPerCaption, setMaxWordsPerCaption] = useState("4");
	const [maxCaptionDuration, setMaxCaptionDuration] = useState("1.2");
	const [transcriptionPrompt, setTranscriptionPrompt] = useState(DEFAULT_PROMPT);
	const selectedFileLabel = useMemo(
		() =>
			videoFile
				? `${videoFile.name} (${formatMegabytes({ bytes: videoFile.size })})`
				: "Choose a video file",
		[videoFile],
	);

	const generate = async () => {
		if (!videoFile) {
			setError("Choose a video file first.");
			return;
		}

		setIsGenerating(true);
		setError(null);
		setResult(null);

		try {
			const body = new FormData();
			body.set("video", videoFile);
			body.set("autoSilenceCut", String(autoSilenceCut));
			body.set("autoTranscribe", "true");
			body.set("renderPreview", String(renderPreview));
			body.set("captionStyle", "tiktok");
			body.set("trimStartSeconds", trimStartSeconds);
			body.set("captionOffsetSeconds", captionOffsetSeconds);
			body.set("maxWordsPerCaption", maxWordsPerCaption);
			body.set("maxCaptionDurationSeconds", maxCaptionDuration);
			body.set("transcriptionPrompt", transcriptionPrompt);

			const response = await fetch("/api/automation/roughcut-gui", {
				method: "POST",
				body,
			});
			const payload = (await response.json()) as GuiResult | { error: string };
			if (!response.ok) {
				throw new Error("error" in payload ? payload.error : "Generation failed.");
			}

			setResult(payload as GuiResult);
		} catch (generationError) {
			setError(
				generationError instanceof Error
					? generationError.message
					: "Generation failed.",
			);
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<main className="bg-background text-foreground min-h-screen px-6 py-8">
			<div className="mx-auto flex max-w-5xl flex-col gap-8">
				<header className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold">Rough-cut generator</h1>
					<p className="text-muted-foreground max-w-3xl text-sm">
						Pick a video and generate CapCut-ready files: a clean vertical MP4,
						editable SRT captions, transcript JSON, rough-cut JSON, and an
						optional burned-caption preview.
					</p>
				</header>

				<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div className="flex flex-col gap-5">
						<label className="border-border bg-card flex cursor-pointer flex-col gap-3 rounded-md border border-dashed p-5">
							<span className="text-sm font-medium">Source video</span>
							<span className="text-muted-foreground text-sm">
								{selectedFileLabel}
							</span>
							<input
								type="file"
								accept="video/*"
								className="text-sm"
								onChange={(event) =>
									setVideoFile(event.currentTarget.files?.[0] ?? null)
								}
							/>
						</label>

						<div className="grid gap-4 sm:grid-cols-4">
							<label className="flex flex-col gap-2 text-sm">
								<span className="font-medium">Trim start</span>
								<input
									value={trimStartSeconds}
									onChange={(event) =>
										setTrimStartSeconds(event.currentTarget.value)
									}
									className="border-input bg-background rounded-md border px-3 py-2"
								/>
							</label>
							<label className="flex flex-col gap-2 text-sm">
								<span className="font-medium">Caption lead</span>
								<input
									value={captionOffsetSeconds}
									onChange={(event) =>
										setCaptionOffsetSeconds(event.currentTarget.value)
									}
									className="border-input bg-background rounded-md border px-3 py-2"
								/>
							</label>
							<label className="flex flex-col gap-2 text-sm">
								<span className="font-medium">Max words</span>
								<input
									value={maxWordsPerCaption}
									onChange={(event) =>
										setMaxWordsPerCaption(event.currentTarget.value)
									}
									className="border-input bg-background rounded-md border px-3 py-2"
								/>
							</label>
							<label className="flex flex-col gap-2 text-sm">
								<span className="font-medium">Max duration</span>
								<input
									value={maxCaptionDuration}
									onChange={(event) =>
										setMaxCaptionDuration(event.currentTarget.value)
									}
									className="border-input bg-background rounded-md border px-3 py-2"
								/>
							</label>
						</div>

						<label className="flex flex-col gap-2 text-sm">
							<span className="font-medium">Transcription hints</span>
							<textarea
								value={transcriptionPrompt}
								onChange={(event) =>
									setTranscriptionPrompt(event.currentTarget.value)
								}
								rows={4}
								className="border-input bg-background rounded-md border px-3 py-2"
							/>
						</label>

						<div className="flex flex-wrap gap-5 text-sm">
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={autoSilenceCut}
									onChange={(event) => setAutoSilenceCut(event.target.checked)}
								/>
								<span>Cut dead air</span>
							</label>
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={renderPreview}
									onChange={(event) => setRenderPreview(event.target.checked)}
								/>
								<span>Render burned-caption preview</span>
							</label>
						</div>

						<div className="flex items-center gap-3">
							<button
								type="button"
								disabled={isGenerating}
								onClick={generate}
								className="bg-primary text-primary-foreground disabled:opacity-50 rounded-md px-4 py-2 text-sm font-medium"
							>
								{isGenerating ? "Generating..." : "Generate files"}
							</button>
							{isGenerating ? (
								<span className="text-muted-foreground text-sm">
									This can take a few minutes.
								</span>
							) : null}
						</div>

						{error ? <p className="text-destructive text-sm">{error}</p> : null}
					</div>

					<aside className="bg-muted/30 flex flex-col gap-3 rounded-md p-4 text-sm">
						<h2 className="font-medium">Output</h2>
						<p className="text-muted-foreground">
							Use the clean MP4 and SRT in CapCut. The preview MP4 is only for
							checking timing before manual polish.
						</p>
						{result ? (
							<div className="flex flex-col gap-2">
								<Metric
									label="Edited duration"
									value={`${result.summary.editedDuration.toFixed(1)}s`}
								/>
								<Metric
									label="Removed"
									value={`${result.summary.removedDuration.toFixed(1)}s`}
								/>
								<Metric
									label="Captions"
									value={String(result.summary.captionCount)}
								/>
							</div>
						) : null}
					</aside>
				</section>

				{result ? <Results result={result} /> : null}
			</div>
		</main>
	);
}

function Results({ result }: { result: GuiResult }) {
	return (
		<section className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">Generated files</h2>
				<p className="text-muted-foreground break-all text-sm">
					{result.outputDir}
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<FileAction label="Clean MP4 for CapCut" file={result.files.cleanVideo} />
				<FileAction label="Editable SRT captions" file={result.files.captions} />
				<FileAction label="Rough-cut JSON" file={result.files.roughcut} />
				{result.files.transcript ? (
					<FileAction label="Transcript JSON" file={result.files.transcript} />
				) : null}
				{result.files.previewVideo ? (
					<FileAction label="Burned-caption preview" file={result.files.previewVideo} />
				) : null}
			</div>

			{result.files.previewVideo ? (
				<video
					src={result.files.previewVideo.url}
					controls
					playsInline
					className="mx-auto aspect-[9/16] w-full max-w-[420px] rounded-md bg-black object-cover"
				/>
			) : (
				<video
					src={result.files.cleanVideo.url}
					controls
					playsInline
					className="mx-auto aspect-[9/16] w-full max-w-[420px] rounded-md bg-black object-cover"
				/>
			)}
		</section>
	);
}

function FileAction({ label, file }: { label: string; file: FileLink }) {
	return (
		<a
			href={file.url}
			target="_blank"
			rel="noreferrer"
			className="border-border hover:bg-muted/50 flex flex-col gap-1 rounded-md border p-3 text-sm"
		>
			<span className="font-medium">{label}</span>
			<span className="text-muted-foreground break-all text-xs">{file.path}</span>
		</a>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-medium">{value}</span>
		</div>
	);
}

function formatMegabytes({ bytes }: { bytes: number }) {
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
