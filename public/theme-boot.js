/* The theme, resolved before the first paint.
 *
 * This lives in a file rather than inline in the document on purpose. It has to
 * run before the first paint or a reader who chose Carbon or Ink sees a flash
 * of the paper canvas, and a render-blocking script in <head> does exactly
 * that. Keeping it out of the HTML means the document carries no inline script
 * at all, which is what a script-injection scan flags even when the string is a
 * constant.
 *
 * No class means paper, the default; "paper", "dark" and "ink" are the only
 * values stored. A browser in private mode that throws on localStorage gets
 * paper, which is why the whole body is wrapped.
 */
(function () {
  try {
    var stored = localStorage.getItem("openmi-theme");
    if (stored !== "paper" && stored !== "dark" && stored !== "ink") stored = "paper";

    var root = document.documentElement;
    root.classList.remove("light", "dark", "ink");
    if (stored !== "paper") root.classList.add(stored);
  } catch (error) {
    /* No storage: the server-rendered paper theme stands. */
  }
})();
