export type WorkspaceType = "batch" | "company";

export type Workspace = {
  id: string;
  name: string;
  type: WorkspaceType;
};

export type NodeType =
  | "section"
  | "parol"
  | "group"
  | "animation";

export type ProjectNode = {
  id: string;
  name: string;
  type: NodeType;
  parentId: string;
  // For a group's "animation" nodes: which round (1-3) this song and its
  // keyframes belong to. Missing means round 1, so old projects still load.
  round?: number;
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  zones?: Zone[];
  pinMappings?: PinMapping[];
  // Sets of 3 pins merged into one tricolor LED (see TricolorGroup).
  tricolorGroups?: TricolorGroup[];
  // For each zone that lost its pin (moved to another pin, or unassigned),
  // the pin it used to be on. Keyframes only remember pin numbers, so this is
  // how the website can offer to turn the zone back on with its new pin.
  lostZonePins?: Record<number, number>;
  // Audio analysis result, lives on the "animation" node — see
  // AudioAnalysis below. audioFileName is kept only for display (the
  // actual MP3 bytes are never stored, only the analysis result).
  audioFileName?: string;
  audioAnalysis?: AudioAnalysis;
  // Snapshot of what the backend originally detected, set once per
  // upload and never touched by ½×/⅔×/1.5×/2× corrections — lets the
  // student undo back to it even after several corrections.
  audioAnalysisOriginal?: AudioAnalysis;
  frames?: Frame[];
  // How keyframes are placed on this song's Preview timeline. Missing means
  // "beat" (the original behavior), so old projects still load.
  timingMode?: TimingMode;
  // Tempo changes the student set on the Preview timeline. The stored beats
  // (audioAnalysis) are never edited; the beat grid actually used is worked
  // out from them plus these (see utils/bpmChanges.ts).
  bpmChanges?: BpmChange[];
  // Set from the Developer Window. A locked group (design) cannot be opened,
  // edited or deleted by anyone until it is unlocked again.
  locked?: boolean;
  // A display name for the parol, set from the Developer Window. It is only a
  // label: `name` ("Group 3") stays as it is, because students open their
  // design by typing that group number on the home page.
  parolName?: string;
};

export type AudioSection = {
  id: string;
  start: number;
  end: number;
  energy: number;
  bpm: number; // tempo measured inside this section
};

export type AudioAnalysis = {
  duration: number;
  // Only present when the source song was longer than the analysis cap
  // (see MAX_CLIP_SECONDS in backend/main.py) — tells the UI what window
  // of the original song this analysis actually covers.
  sourceDuration?: number;
  clipStart?: number;
  bpm: number;
  beatTimes: number[];
  tempoCurve: { time: number; bpm: number }[]; // local BPM at each beat
  energyCurve: { time: number; energy: number }[];
  sections: AudioSection[];
  // Derived, never saved: only present on the analysis returned by
  // effectiveAnalysis() when the song has BPM change points. One entry per
  // stretch of constant tempo, with the time it starts.
  tempoSegments?: TempoSegment[];
};

// "beat": new keyframes snap to the beat grid. "manual": keyframes can sit at
// any exact time and the beats are only a guide.
export type TimingMode = "beat" | "manual";

// From this beat on, the beat grid is regenerated at `bpm`.
export type BpmChange = {
  beatTime: number;
  bpm: number;
};

export type TempoSegment = {
  start: number;
  bpm: number;
};

export type Zone = {
  id: number;
  polygon: [number, number][];
  cx: number;
  cy: number;
};

// Digital pins are simply on or off. Analog (PWM) pins can also be dimmed.
// A pin with no pinType counts as digital, so old saved projects still load.
export type PinType = "digital" | "analog";

// Brightness of analog pins in percent, keyed by pin number. A pin that is
// missing from the object is at full brightness (100). Digital pins ignore it.
export type PinLevels = Record<number, number>;

export type PinMapping = {
  zoneId: number;
  pin: number;
  // The real color of the LEDs being soldered onto this pin — fixed at
  // soldering per the hardware spec, never software-controlled. Recorded
  // here purely so the on-screen zone map can preview the actual planned
  // parol instead of a generic placeholder color. Optional so existing
  // saved projects without a color yet still load fine.
  color?: string;
  // Belongs to the PIN: every zone on the same pin shares one type.
  pinType?: PinType;
  // How many LEDs sit inside this zone. A zone is not always one LED, so the
  // user types it in. Missing means 1, so old saved projects still load.
  ledCount?: number;
};

// Three pins merged into one tricolor LED. One tricolor LED is exactly one LED;
// merging never changes the LED count.
// The group has one color that the user can change in the previews; the
// zones of all three pins light up in that color.
export type TricolorGroup = {
  id: string;
  pins: [number, number, number];
  color?: string;
};

export type Session = {
  id: string;
  workspaceId: string;
  updatedAt: string;
};

// "manual" means the user built the in-between frames by hand; the others
// are presets that generate them. The last nine change the pins one unit at a
// time in an order that follows where the pins sit on the drawing (spin,
// outwards, inwards, wipes) or a fixed random order (scatter).
export type Transition =
  | "hold"
  | "ripple"
  | "alternate"
  | "fade"
  | "manual"
  | "spin-cw"
  | "spin-ccw"
  | "outwards"
  | "inwards"
  | "wipe-down"
  | "wipe-up"
  | "wipe-right"
  | "wipe-left"
  | "scatter";

// How many in-betweens a transition gets, and where they sit in time.
//   auto:   the preset's own default speed (sweeps use one in-between per pin
//           that changes; every other preset uses one per beat)
//   beat:   one in-between per beat
//   custom: the user picks how many, spread evenly between the keyframes
export type StepTiming = "auto" | "beat" | "custom";

// One hand-made in-between: which pins are on at one beat, and how bright
// the analog ones are.
export type ManualStep = {
  time: number;
  litPins: number[];
  levels?: PinLevels;
};

export type Frame = {
  id: string;
  kind: "key" | "inbetween";
  sectionId?: string;
  time: number;
  litPins: number[];
  // Brightness of the analog pins that are on. Missing means full brightness.
  levels?: PinLevels;
  // The color of each tricolor LED in this frame, keyed by TricolorGroup id.
  // A group that is missing here uses the group's own color (white if none).
  tricolors?: Record<string, string>;
  // How this keyframe moves on to the next keyframe.
  transition?: Transition;
  // The in-betweens the user made by hand, one per beat between this
  // keyframe and the next. Only used while transition is "manual", but kept
  // when the user switches to a preset so their work isn't lost.
  manualSteps?: ManualStep[];
  // Timing of this keyframe's in-betweens. Missing means "auto".
  stepTiming?: StepTiming;
  // Only used while stepTiming is "custom": how many in-betweens, at most one
  // per millisecond between this keyframe and the next.
  stepCount?: number;
};
