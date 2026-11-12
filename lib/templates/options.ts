/**
 * What the template picker shows.
 *
 * Separate from the catalogue on purpose: the catalogue carries every file's
 * contents, and a client component must not download a whole starter app to
 * render a dropdown. `tests/templates.test.ts` asserts the two lists agree, so a
 * template cannot appear here without existing there.
 */

export type TemplateOption = {
  id: string;
  name: string;
  description: string;
  files: number;
};

export const TEMPLATE_OPTIONS: readonly TemplateOption[] = [
  {
    id: "next-starter",
    name: "Next.js starter",
    description: "App Router, one page, no database. Previews on port 3000.",
    files: 8,
  },
  {
    id: "vite-react",
    name: "Vite + React",
    description: "One component, one stylesheet. Previews on port 5173.",
    files: 8,
  },
];
