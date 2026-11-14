/**
 * A chat is named by what it was asked, not by the fact that it is new.
 *
 * Every chat used to be inserted as "New chat" and stay that way, which made
 * the sidebar a column of identical rows. The title is derived from the first
 * message on the server, where the message already is — no extra model call, no
 * second place where a title could be invented.
 *
 * The rule is deliberately dull: collapse whitespace, keep the first line, cut
 * on a word boundary. A title is a label for a list row, not a summary.
 */

export const CHAT_TITLE_MAX = 60;

export function titleFromMessage(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();

  if (line.length === 0) return "New chat";
  if (line.length <= CHAT_TITLE_MAX) return line;

  const cut = line.slice(0, CHAT_TITLE_MAX);
  const boundary = cut.lastIndexOf(" ");

  // A single long token (a URL, a hashed name) has no boundary to cut on, so it
  // is cut where the cap falls rather than padded with a space.
  const kept = boundary > CHAT_TITLE_MAX / 2 ? cut.slice(0, boundary) : cut;

  return `${kept.trimEnd()}…`;
}
