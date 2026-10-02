    import type { AudioAnalysis, Frame } from "../types";

    // One empty key frame at the start of each song section.
    export function makeKeyFrames(analysis: AudioAnalysis): Frame[] {
      return analysis.sections.map((section): Frame => ({
        id: crypto.randomUUID(),
        kind: "key",
        sectionId: section.id,
        time: section.start,
        litPins: [],
      }));
    }

    // Beat times that fall between two key frames (where in-betweens go).
    export function beatsBetween(
      analysis: AudioAnalysis,
      start: number,
      end: number,
    ): number[] {
      return analysis.beatTimes.filter((t) => t > start && t < end);
    }