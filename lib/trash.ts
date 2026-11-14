/**
 * How long a trashed chat waits before it is deleted for good.
 *
 * Trash was a one-way door with no clock: a chat stayed in the bin until
 * somebody emptied it by hand, which is not what "trash" means anywhere else.
 * The sweep at `/api/cron/sandbox-sweep` reads this constant, and the trash view
 * says the same number, so the promise and the deletion cannot drift.
 */

export const TRASH_RETENTION_DAYS = 30;

export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The oldest `deleted_at` a row may still have. Anything earlier is due. */
export function trashCutoff(now: number = Date.now()): string {
  return new Date(now - TRASH_RETENTION_MS).toISOString();
}
