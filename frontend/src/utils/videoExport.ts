import type { Frame, ProjectNode } from "../types";
import { FULL_LEVEL, groupOfPin, levelOf } from "./pins";

// Records the parol preview (and the song) into a video file, all in the
// browser. The preview on screen is an <img> + SVG, which can't be recorded
// directly, so this redraws the same picture on a <canvas> every frame and
// records that with MediaRecorder. The song is decoded with the Web Audio API
// and fed into the recording, so the sound is locked to the lights.
//
// It runs in REAL TIME (a 2 minute song takes 2 minutes) and the browser tab
// must stay open and visible while it runs.

const DEFAULT_LIT_COLOR = "#ffd98a"; // same as ParolPreview
const BACKGROUND = "#0b0b0b";
const MAX_WIDTH = 1280; // video width cap, keeps files and CPU use sensible
const FPS = 30;
const SAME_MOMENT = 0.02; // same rule SequenceEditor uses for "at this time"
const TAIL_SECONDS = 0.5; // a short rest at the end so the last beat isn't cut

export type VideoExportOptions = {
  // The Group node (drawing, zones, pin mappings, tricolor groups).
  node: ProjectNode;
  // Keyframes AND in-betweens, so the video matches the Preview tab.
  frames: Frame[];
  // Length of the analyzed clip, in seconds.
  duration: number;
  // Where the clip starts inside the stored (untrimmed) song.
  clipStart: number;
  // The song file's bytes. Leave out for a silent video.
  audioData?: ArrayBuffer;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

export type VideoExportResult = {
  blob: Blob;
  extension: "webm" | "mp4";
  // False when there was no audio, or the file couldn't be decoded.
  hasAudio: boolean;
};

export function isVideoExportSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype
  );
}

function pickMimeType(): { mimeType: string; extension: "webm" | "mp4" } | null {
  const candidates: { mimeType: string; extension: "webm" | "mp4" }[] = [
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
    { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the drawing."));
    img.src = src;
  });
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportVideo(
  options: VideoExportOptions,
): Promise<VideoExportResult> {
  const { node, frames, duration, clipStart, audioData, onProgress, signal } =
    options;

  if (!isVideoExportSupported()) {
    throw new Error("This browser can't record video. Try Chrome, Edge or Firefox.");
  }
  const format = pickMimeType();
  if (!format) throw new Error("This browser has no supported video format.");

  if (!node.imageDataUrl || !node.zones || !node.pinMappings) {
    throw new Error("The drawing, zones and pins must be set up first.");
  }

  const imageWidth = node.imageWidth ?? 1;
  const imageHeight = node.imageHeight ?? 1;
  const zones = node.zones;
  const pinMappings = node.pinMappings;
  const groups = node.tricolorGroups ?? [];
  const zoneToMapping = new Map(pinMappings.map((m) => [m.zoneId, m]));

  // ---- Canvas size ----
  const width = even(Math.min(imageWidth, MAX_WIDTH));
  const height = even((width * imageHeight) / imageWidth);
  const scale = width / imageWidth;

  // ---- The dimmed drawing, prepared once ----
  // Same look as the preview's invert(1) brightness(0.45) CSS filter, done
  // on the pixels so it also works in browsers without canvas filters.
  const img = await loadImage(node.imageDataUrl);
  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const baseCtx = base.getContext("2d")!;
  const art = document.createElement("canvas");
  art.width = width;
  art.height = height;
  const artCtx = art.getContext("2d")!;
  artCtx.drawImage(img, 0, 0, width, height);
  const pixels = artCtx.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = (255 - pixels.data[i]) * 0.45;
    pixels.data[i + 1] = (255 - pixels.data[i + 1]) * 0.45;
    pixels.data[i + 2] = (255 - pixels.data[i + 2]) * 0.45;
  }
  artCtx.putImageData(pixels, 0, 0);
  baseCtx.fillStyle = BACKGROUND;
  baseCtx.fillRect(0, 0, width, height);
  baseCtx.drawImage(art, 0, 0);

  // ---- Drawing one frame ----
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const glowLayer = document.createElement("canvas");
  glowLayer.width = width;
  glowLayer.height = height;
  const glowCtx = glowLayer.getContext("2d")!;
  const supportsFilter =
  typeof (ctx as unknown as { filter?: unknown }).filter === "string";
  const glowPx = Math.max(imageWidth, imageHeight) * 0.008 * scale;

  const colorOf = (zoneId: number) => {
    const mapping = zoneToMapping.get(zoneId);
    const group = mapping ? groupOfPin(groups, mapping.pin) : undefined;
    return group ? (group.color ?? "#ffffff") : (mapping?.color ?? DEFAULT_LIT_COLOR);
  };

  const brightnessOf = (
    zoneId: number,
    lit: Set<number>,
    levels: Frame["levels"],
  ) => {
    const mapping = zoneToMapping.get(zoneId);
    if (!mapping) return 1;
    const group = groupOfPin(groups, mapping.pin);
    const pins = group ? group.pins.filter((p) => lit.has(p)) : [mapping.pin];
    return Math.max(
      ...pins.map((p) => {
        const m = pinMappings.find((x) => x.pin === p);
        return m?.pinType === "analog" ? levelOf(levels, p) / FULL_LEVEL : 1;
      }),
    );
  };

  const tracePolygon = (
    target: CanvasRenderingContext2D,
    polygon: [number, number][],
  ) => {
    target.beginPath();
    polygon.forEach(([x, y], i) => {
      if (i === 0) target.moveTo(x * scale, y * scale);
      else target.lineTo(x * scale, y * scale);
    });
    target.closePath();
  };

  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const frameAt = (t: number): Frame | undefined => {
    let current: Frame | undefined;
    for (const f of sorted) {
      if (f.time <= t + SAME_MOMENT) current = f;
      else break;
    }
    return current;
  };

  const drawAt = (t: number) => {
    const frame = frameAt(t);
    const lit = new Set(frame?.litPins ?? []);
    const levels = frame?.levels;

    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.drawImage(base, 0, 0);

    const litZones = zones.filter((zone) => {
      const mapping = zoneToMapping.get(zone.id);
      return mapping !== undefined && lit.has(mapping.pin);
    });
    if (litZones.length === 0) return;

    // Soft glow: all lit zones on one layer, blurred once.
    glowCtx.clearRect(0, 0, width, height);
    for (const zone of litZones) {
      glowCtx.globalAlpha = 0.9 * brightnessOf(zone.id, lit, levels);
      glowCtx.fillStyle = colorOf(zone.id);
      tracePolygon(glowCtx, zone.polygon);
      glowCtx.fill();
    }
    glowCtx.globalAlpha = 1;
    if (supportsFilter) {
      ctx.filter = blur(${glowPx}px);
      ctx.drawImage(glowLayer, 0, 0);
      ctx.filter = "none";
    } else {
      // No canvas filters (older Safari): fake the glow with a shadow.
      ctx.shadowBlur = glowPx * 2;
      for (const zone of litZones) {
        ctx.shadowColor = colorOf(zone.id);
        ctx.globalAlpha = 0.5 * brightnessOf(zone.id, lit, levels);
        ctx.fillStyle = colorOf(zone.id);
        tracePolygon(ctx, zone.polygon);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    }

    // Crisp lit zones on top.
    for (const zone of litZones) {
      ctx.globalAlpha = 0.85 * brightnessOf(zone.id, lit, levels);
      ctx.fillStyle = colorOf(zone.id);
      tracePolygon(ctx, zone.polygon);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  drawAt(0);

  // ---- Audio ----
  let audioCtx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  const stream = canvas.captureStream(FPS);
  let hasAudio = false;

  if (audioData) {
    try {
      audioCtx = new AudioContext();
      const buffer = await audioCtx.decodeAudioData(audioData.slice(0));
      const destination = audioCtx.createMediaStreamDestination();
      source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination); // not connected to the speakers: silent while recording
      destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      hasAudio = true;
    } catch {
      audioCtx?.close().catch(() => {});
      audioCtx = null;
      source = null;
    }
  }

  // ---- Record, in real time ----
  return new Promise<VideoExportResult>((resolve, reject) => {
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: 5_000_000,
    });
    const chunks: Blob[] = [];
    let frameId = 0;
    let finished = false;
    let cancelled = false;

    const cleanup = () => {
      cancelAnimationFrame(frameId);
      signal?.removeEventListener("abort", onAbort);
      try {
        source?.stop();
      } catch {
        // already stopped
      }
      stream.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch(() => {});
    };

    const onAbort = () => {
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      else {
        cleanup();
        reject(new DOMException("Cancelled", "AbortError"));
      }
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("Recording failed."));
    };
    recorder.onstop = () => {
      cleanup();
      if (cancelled) {
        reject(new DOMException("Cancelled", "AbortError"));
        return;
      }
      resolve({
        blob: new Blob(chunks, { type: format.mimeType.split(";")[0] }),
        extension: format.extension,
        hasAudio,
      });
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);

    const run = async () => {
      if (audioCtx) await audioCtx.resume();
      recorder.start(1000);

      const startedAt = performance.now();
      const audioStart = audioCtx ? audioCtx.currentTime : 0;
      if (source) source.start(0, clipStart, duration + TAIL_SECONDS);

      const total = duration + TAIL_SECONDS;
      const tick = () => {
        if (finished) return;
        const t = audioCtx
          ? audioCtx.currentTime - audioStart
          : (performance.now() - startedAt) / 1000;
        drawAt(Math.min(t, duration));
        onProgress?.(Math.min(1, t / total));
        if (t >= total) {
          finished = true;
          if (recorder.state !== "inactive") recorder.stop();
          return;
        }
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);
    };

    run().catch((error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("Export failed."));
    });
  });
}
