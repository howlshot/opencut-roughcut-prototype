import type { RoughCutCaption, RoughCutDocument } from "../../src/automation/roughcut/types";

export function roughCutCaptionsToSrt({ roughCut }: { roughCut: RoughCutDocument }): string {
	return roughCut.captions
		.filter((caption) => caption.durationSeconds > 0)
		.map((caption, index) => {
			const start = formatSrtTimestamp({ seconds: caption.startTimeSeconds });
			const end = formatSrtTimestamp({
				seconds: caption.startTimeSeconds + caption.durationSeconds,
			});
			return `${index + 1}\n${start} --> ${end}\n${caption.text}\n`;
		})
		.join("\n");
}

function formatSrtTimestamp({ seconds }: { seconds: number }): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const hours = Math.floor(totalMilliseconds / 3_600_000);
	const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
	const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
	const milliseconds = totalMilliseconds % 1000;
	return `${pad({ value: hours, length: 2 })}:${pad({ value: minutes, length: 2 })}:${pad({ value: wholeSeconds, length: 2 })},${pad({ value: milliseconds, length: 3 })}`;
}

function pad({ value, length }: { value: number; length: number }): string {
	return String(value).padStart(length, "0");
}
