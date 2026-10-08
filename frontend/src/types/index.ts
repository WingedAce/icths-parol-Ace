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

// Three pins merged into one tricolor LED. One tricolor LED counts as 3 LEDs.
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

// "manual" means the user built the in-between frames by hand; the other
// four are presets that generate them.
export type Transition = "hold" | "ripple" | "alternate" | "fade" | "manual";

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
  // How this keyframe moves on to the next keyframe.
  transition?: Transition;
  // The in-betweens the user made by hand, one per beat between this
  // keyframe and the next. Only used while transition is "manual", but kept
  // when the user switches to a preset so their work isn't lost.
  manualSteps?: ManualStep[];
};