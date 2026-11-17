/**
 * The date a prompt is told.
 *
 * Every model this app calls has a training cutoff, and every one of them will
 * happily write last year's date into a changelog. The date is therefore part
 * of the prompt contract, not a detail: it is computed on the server at the
 * moment the prompt is built, injected as an ordinary sentence, and compared
 * against the day a model does not otherwise know.
 *
 * One function so the chat prompt and the mission prompt cannot disagree about
 * what day it is, and so a test can pass a fixed date instead of waiting for
 * midnight.
 */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
