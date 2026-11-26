import { ensureSession, supabase } from "./supabase";

// An instant "something changed" message between every open screen, over
// Supabase Realtime (the same kind of connection the group counter uses).
//
// When a developer presses TEST RUN / Unlock Special Round / changes the
// duration, their screen sends one small message. Every other screen that
// receives it re-reads the Special Round state from the database straight
// away, instead of waiting for its next check. The message carries NO data
// and decides nothing: the real state always comes from the database, which
// only a developer can change. So a fake or stray message can only cause an
// extra re-read. If Realtime is blocked or down, nothing breaks: screens still
// re-read on their own every couple of seconds.

const TOPIC = "special-round-signal";
const EVENT = "changed";

type SignalChannel = ReturnType<typeof supabase.channel>;

const listeners = new Set<() => void>();
let channel: SignalChannel | null = null;
let connecting: Promise<boolean> | null = null;

function connect(): Promise<boolean> {
  if (connecting) return connecting;
  connecting = (async () => {
    let ch: SignalChannel | null = null;
    try {
      if (!(await ensureSession())) throw new Error("no session");
      ch = supabase.channel(TOPIC);
      ch.on("broadcast", { event: EVENT }, () => {
        listeners.forEach((fn) => fn());
      });
      const joined = ch;
      await new Promise<void>((resolve, reject) => {
        joined.subscribe((status: string) => {
          if (status === "SUBSCRIBED") resolve();
          else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            reject(new Error(status));
          }
        });
      });
      channel = ch;
      return true;
    } catch (error) {
      console.warn("Special Round live updates unavailable (using polling):", error);
      if (ch) void supabase.removeChannel(ch);
      channel = null;
      connecting = null; // try again next time
      return false;
    }
  })();
  return connecting;
}

/** Calls `onChange` whenever another screen announces a change. Returns an unsubscribe. */
export function onSpecialRoundSignal(onChange: () => void): () => void {
  listeners.add(onChange);
  void connect();
  return () => {
    listeners.delete(onChange);
  };
}

/** Tells every other open screen to re-read the Special Round state now. */
export async function notifySpecialRoundChanged(): Promise<void> {
  try {
    if (!(await connect()) || !channel) return;
    await channel.send({ type: "broadcast", event: EVENT, payload: {} });
  } catch {
    // Best effort: the 2-second check still catches the change.
  }
}
