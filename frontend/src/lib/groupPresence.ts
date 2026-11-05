// Live "how many people have this group's design open right now".
//
// Uses Supabase Realtime Presence: nothing is saved to the database, the
// number only exists while people have the page open, and it disappears when
// they leave.
//
// DEVELOPERS ARE NEVER COUNTED. A signed-in admin can watch the count, but
// never adds themselves to it. If the app cannot tell whether this person is
// an admin (for example the check fails), it also does not add them, so a
// developer can't slip into the count by accident.
//
// People are counted by their login session, not by tab, so one student with
// the design open in two tabs counts once.

import { useEffect, useState } from "react";

import { ensureSession, supabase } from "./supabase";

type PresenceMeta = { student: boolean };

export function useGroupPresence(groupId: string | undefined): number | null {
  const [state, setState] = useState<{ groupId: string; count: number } | null>(
    null,
  );

  useEffect(() => {
    if (!groupId) return;

    let cancelled = false;
    let cleanup = () => {};

    void (async () => {
      try {
        if (!(await ensureSession()) || cancelled) return;

        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId || cancelled) return;

        // Only a clear "false" counts as a student. An admin ("true") or a
        // failed check (error) is never added to the count.
        const { data: isAdmin, error } = await supabase.rpc("is_admin");
        const countsAsStudent = !error && isAdmin === false;
        if (cancelled) return;

        const channel = supabase.channel(`presence:group:${groupId}`, {
          config: { presence: { key: userId } },
        });

        const recount = () => {
          const people = channel.presenceState<PresenceMeta>();
          let count = 0;
          for (const key of Object.keys(people)) {
            if (people[key].some((meta: PresenceMeta) => meta.student === true)) count += 1;
          }
          if (!cancelled) setState({ groupId, count });
        };

        channel
          .on("presence", { event: "sync" }, recount)
          .subscribe(async (status: string) => {
            if (status === "SUBSCRIBED" && countsAsStudent) {
              await channel.track({ student: true });
            }
          });

        cleanup = () => {
          void supabase.removeChannel(channel);
        };
      } catch {
        // Presence is a nice-to-have. If it fails, the counter just stays
        // hidden and nothing else in the app is affected.
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [groupId]);

  // Ignore a number that belongs to a previously opened group.
  return state && state.groupId === groupId ? state.count : null;
}
