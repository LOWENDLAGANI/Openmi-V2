/**
 * Limits a chat message is held to, shared by the two sides that care.
 *
 * The server refuses an over-cap message with a typed error and the composer
 * counts characters against the same number, so the reader is warned before
 * they press send instead of after. Two copies of the constant would drift, and
 * the failure would look like a broken send button.
 */
export const MAX_MESSAGE_CHARS = 20_000;
