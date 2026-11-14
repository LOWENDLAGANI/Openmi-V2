import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Responsiveness is a contract, not a feeling: a control has to answer the
 * press before the server answers, must not accept a second press while the
 * first is in flight, and must put itself back when the work fails. These
 * assertions pin the shared machinery, because the failure mode of getting it
 * wrong is invisible in a fast local build and obvious on a slow connection —
 * or as a duplicate receipt, folder or approval.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const HOOK = read("/components/useOptimisticAction.ts");
const PENDING = read("/components/PendingButton.tsx");
const SUBMIT = read("/components/SubmitButton.tsx");
const CONFIRM = read("/components/ConfirmSubmit.tsx");
const CSS = read("/app/globals.css");

test("the optimistic value is painted first and rolled back by React", () => {
  // `useOptimistic` is what makes the revert automatic: the guess is discarded
  // when the transition ends, and the confirmed value is painted again.
  expect(HOOK).toContain("useOptimistic");
  expect(HOOK).toContain("startTransition(async () => {");
  expect(HOOK).toContain("applyOptimistic(optimistic);");
  expect(HOOK).toContain('if (result && result.ok === false) snapBack();');
  expect(HOOK).toContain("catch {");
});

test("one press starts one request, even between renders", () => {
  // The disabled attribute is the visible guard; the ref is the one a second
  // pointer event cannot slip past before React re-renders.
  expect(HOOK).toContain("if (inFlight.current) return;");
  expect(HOOK).toContain("inFlight.current = true;");
  expect(HOOK).toContain("inFlight.current = false;");

  expect(PENDING).toContain("disabled={pending || disabled}");
  expect(SUBMIT).toContain("disabled={pending || disabled}");
  expect(CONFIRM).toContain("disabled={pending}");
});

test("the buttons show the result, and the failed ones snap back", () => {
  expect(PENDING).toContain("optimisticText ?? pendingText");
  expect(SUBMIT).toContain("optimisticText ?? pendingText");
  expect(CONFIRM).toContain("optimisticText ?? pendingText");

  // A form's outcome belongs to the button that was pressed, not to every
  // submit button sharing the form.
  expect(SUBMIT).toContain("pending && pressed");
  expect(CONFIRM).toContain("pending && pressed");
  expect(CONFIRM).toContain("if (!window.confirm(message)) {");

  expect(PENDING).toContain('snapped ? "snap-back"');
  expect(CSS).toContain("@keyframes snap-back");
  expect(CSS).toContain(".snap-back {");
});

test("a control holding a request stays legible instead of looking dead", () => {
  expect(CSS).toContain('.btn[aria-busy="true"]');
  expect(PENDING).toContain("aria-busy={pending}");
  expect(SUBMIT).toContain("aria-busy={pending}");
});

test("the lists apply a removal on the click and keep the request", () => {
  const LIST = read("/components/ChatList.tsx");
  const TRASH = read("/components/TrashList.tsx");

  // The guess and the request are the same press: the list is edited first and
  // the server action still runs, which is what makes React able to roll back.
  expect(LIST).toContain("useOptimistic");
  expect(LIST).toContain('onChange({ kind: "trash", chatId: chat.id });');
  expect(LIST).toContain("await trashChat(formData);");
  expect(LIST).toContain('kind: "delete-folder"');
  expect(LIST).toContain("await moveChatToFolder(formData);");

  expect(TRASH).toContain('change({ kind: "one", chatId });');
  expect(TRASH).toContain('change({ kind: "all" });');
  expect(TRASH).toContain("await purgeChat(formData);");
  expect(TRASH).toContain("await restoreChat(formData);");

  // Creating a folder is not guessed: its id comes from the server.
  expect(LIST).not.toContain('kind: "create-folder"');
});

test("the context ring reports tokens and says the figure is an estimate", () => {
  const CIRCLE = read("/components/ContextCircle.tsx");
  const CONTEXT = read("/lib/context.ts");

  expect(CONTEXT).toContain("export function estimateTokens");
  expect(CONTEXT).toContain("CHARS_PER_TOKEN = 4");
  expect(CIRCLE).toContain("estimateTokens(usedChars)");
  expect(CIRCLE).toContain("tokens");
  expect(CIRCLE).not.toContain("characters used");
});

test("no action button renders a spinner as its wait state", () => {
  // The spinner says "wait"; these controls say what they did. The optimistic
  // label plus the lock is the whole feedback.
  for (const source of [PENDING, SUBMIT, CONFIRM]) {
    expect(source).not.toContain("<Spinner");
  }
});
