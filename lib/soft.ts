/**
 * A read that is allowed to fail without taking the page with it.
 *
 * The chat page reads one thing the reader came for — the transcript — and half
 * a dozen auxiliary things: the repository citation index, the operator check,
 * the GitHub connection, the balance. Those used to sit in the same
 * `Promise.all`, so one rejected promise rejected the whole batch and the
 * conversation was replaced by an error screen. A missing GitHub token, an auth
 * hiccup or an admin RPC that is not there yet is not a reason to lose the chat.
 *
 * `soft` resolves to a stated fallback instead. Every use names what "missing"
 * looks like for that read, so a partial page is still a truthful one.
 */
export async function soft<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}
