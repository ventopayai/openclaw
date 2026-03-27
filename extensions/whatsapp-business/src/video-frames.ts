/**
 * Extract evenly-spaced frames from a video file using ffmpeg/ffprobe.
 * Used to provide visual context to the agent when a video is received.
 */

import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const FFPROBE_TIMEOUT_MS = 10_000;
const FFMPEG_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const TARGET_FRAME_COUNT = 5;
const MIN_FRAME_COUNT = 1;
const MAX_FRAME_COUNT = 8;

const EXEC_OPTS: ExecFileOptions = { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: MAX_BUFFER };

/** Get video duration in seconds using ffprobe. */
async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      videoPath,
    ],
    { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
  );

  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid video duration: ${stdout.trim()}`);
  }
  return duration;
}

/**
 * Calculate timestamps for frame extraction.
 * Distributes frames evenly across the video, avoiding the very start (often black)
 * and the very end.
 */
function calculateTimestamps(durationSecs: number): number[] {
  // For very short videos (<3s), just take the middle frame
  if (durationSecs < 3) {
    return [durationSecs / 2];
  }

  // Scale frame count with duration: ~1 frame per 6 seconds, clamped
  const count = Math.min(
    MAX_FRAME_COUNT,
    Math.max(MIN_FRAME_COUNT, Math.round(durationSecs / 6)),
  );
  const frameCount = Math.min(count, TARGET_FRAME_COUNT);

  // Offset from start/end by 5% to avoid black frames
  const startOffset = durationSecs * 0.05;
  const endOffset = durationSecs * 0.95;
  const usableDuration = endOffset - startOffset;

  if (frameCount === 1) {
    return [durationSecs / 2];
  }

  const step = usableDuration / (frameCount - 1);
  const timestamps: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    timestamps.push(Math.round((startOffset + step * i) * 100) / 100);
  }
  return timestamps;
}

/** Extract a single frame at a given timestamp. */
async function extractFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-ss", String(timestamp),
      "-i", videoPath,
      "-vframes", "1",
      "-q:v", "2", // high quality JPEG
      "-y",
      outputPath,
    ],
    EXEC_OPTS,
  );
}

export type ExtractedFrames = {
  framePaths: string[];
  timestamps: number[];
  durationSecs: number;
  cleanup: () => Promise<void>;
};

/**
 * Extract evenly-spaced frames from a video.
 * Returns paths to JPEG frame files and a cleanup function.
 * Returns null if ffmpeg is not available or extraction fails.
 */
export async function extractVideoFrames(
  videoPath: string,
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): Promise<ExtractedFrames | null> {
  let tmpDir: string | undefined;

  try {
    const durationSecs = await getVideoDuration(videoPath);
    const timestamps = calculateTimestamps(durationSecs);

    log?.info(`Extracting ${timestamps.length} frames from ${durationSecs.toFixed(1)}s video at: ${timestamps.map((t) => `${t.toFixed(1)}s`).join(", ")}`);

    tmpDir = await mkdtemp(join(tmpdir(), "wab-video-frames-"));
    const framePaths: string[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const outputPath = join(tmpDir, `frame_${i + 1}.jpg`);
      try {
        await extractFrame(videoPath, timestamps[i] as number, outputPath);
        framePaths.push(outputPath);
      } catch (err) {
        log?.warn(`Failed to extract frame at ${timestamps[i]}s: ${(err as Error).message}`);
      }
    }

    if (framePaths.length === 0) {
      log?.warn("No frames extracted from video");
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return null;
    }

    log?.info(`Extracted ${framePaths.length}/${timestamps.length} frames`);

    const cleanupDir = tmpDir;
    return {
      framePaths,
      timestamps: timestamps.slice(0, framePaths.length),
      durationSecs,
      cleanup: async () => {
        await rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (err) {
    const errMsg = (err as Error).message;
    // ffmpeg/ffprobe not installed — not an error, just a limitation
    if (errMsg.includes("ENOENT") || errMsg.includes("not found")) {
      log?.warn("ffmpeg/ffprobe not available, skipping video frame extraction");
    } else {
      log?.warn(`Video frame extraction failed: ${errMsg}`);
    }
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}
