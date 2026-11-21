// The fixed songs Practice can roll. Each one is a 60-second clip kept in
// public/practice/ as <id>.mp3 with its beat analysis in <id>.json, so a roll
// needs no analysis server and no upload.

export type PracticeSong = {
  id: string;
  title: string;
  /** Relative chance of being rolled. Songs without one share what is left. */
  weight?: number;
};

export const PRACTICE_SONGS: PracticeSong[] = [
  { id: "merry-christmas-please-dont-call", title: "Merry Christmas Please Don't Call", weight: 5 },
  { id: "ako-ang-bagyo", title: "Ako ang Bagyo", weight: 1 },
  { id: "carol-of-the-bells", title: "Carol of the Bells" },
  { id: "joy-to-the-world", title: "Joy to the World" },
  { id: "feliz-navidad", title: "Feliz Navidad" },
  { id: "jingle-bell-rock", title: "Jingle Bell Rock" },
  { id: "kumukutikutitap", title: "Kumukutikutitap" },
  { id: "sleigh-ride", title: "Sleigh Ride" },
  { id: "rockin-around", title: "Rockin' Around the Christmas Tree" },
  { id: "all-i-want", title: "All I Want for Christmas Is You" },
];

// Weights as percentages: the songs with a set weight keep it, the rest split
// what is left of 100 equally.
function weightOf(song: PracticeSong, songs: PracticeSong[]): number {
  if (song.weight !== undefined) return song.weight;
  const fixed = songs.reduce((sum, s) => sum + (s.weight ?? 0), 0);
  const open = songs.filter((s) => s.weight === undefined).length;
  return open > 0 ? Math.max(0, 100 - fixed) / open : 0;
}

// Picks one song at random by those weights. The song that is already playing
// is left out, so a roll always changes the song.
export function rollPracticeSong(
  currentTitle?: string,
  random: () => number = Math.random,
  songs: PracticeSong[] = PRACTICE_SONGS,
): PracticeSong {
  const pool = songs.filter((s) => s.title !== currentTitle);
  const choices = pool.length > 0 ? pool : songs;
  const weights = choices.map((s) => weightOf(s, songs));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let point = random() * total;
  for (let i = 0; i < choices.length; i += 1) {
    point -= weights[i];
    if (point < 0) return choices[i];
  }
  return choices[choices.length - 1];
}
