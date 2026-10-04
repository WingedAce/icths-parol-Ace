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
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  zones?: Zone[];
  pinMappings?: PinMapping[];
  // Audio analysis result, lives on the "animation" node — see
  // AudioAnalysis below. audioFileName is kept only for display (the
  // actual MP3 bytes are never stored, only the analysis result).
  audioFileName?: string;
  audioAnalysis?: AudioAnalysis;
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

export type PinMapping = {
  zoneId: number;
  pin: number;
  // The real color of the LEDs being soldered onto this pin — fixed at
  // soldering per the hardware spec, never software-controlled. Recorded
  // here purely so the on-screen zone map can preview the actual planned
  // parol instead of a generic placeholder color. Optional so existing
  // saved projects without a color yet still load fine.
  color?: string;
};

export type Session = {
  id: string;
  workspaceId: string;
  updatedAt: string;
};

// "manual" means the user built the in-between frames by hand; the other
// three are presets that generate them.
export type Transition = "hold" | "ripple" | "alternate" | "manual";

// One hand-made in-between: which pins are on at one beat.
export type ManualStep = {
  time: number;
  litPins: number[];
};

export type Frame = {
  id: string;
  kind: "key" | "inbetween";
  sectionId?: string;
  time: number;
  litPins: number[];
  // How this keyframe moves on to the next keyframe.
  transition?: Transition;
  // The in-betweens the user made by hand, one per beat between this
  // keyframe and the next. Only used while transition is "manual", but kept
  // when the user switches to a preset so their work isn't lost.
  manualSteps?: ManualStep[];
};