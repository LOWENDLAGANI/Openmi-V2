import { expect, test } from "bun:test";

import { parseBlocks, parseInline } from "../lib/markdown";

test("asterisk bullets are list items, not asterisks in the prose", () => {
  const blocks = parseBlocks("* first point\n* second point\n* third point");

  expect(blocks).toEqual([
    { kind: "bullets", items: ["first point", "second point", "third point"] },
  ]);
  expect(JSON.stringify(blocks)).not.toContain("*");
});

test("dash and plus bullets, and wrapped lines, belong to one list", () => {
  expect(parseBlocks("- one\n- two")).toEqual([
    { kind: "bullets", items: ["one", "two"] },
  ]);

  expect(parseBlocks("+ one\n  continued here\n+ two")).toEqual([
    { kind: "bullets", items: ["one continued here", "two"] },
  ]);
});

test("numbered lists, quotes, headings and rules each get a block", () => {
  expect(parseBlocks("1. one\n2. two")).toEqual([
    { kind: "ordered", items: ["one", "two"] },
  ]);

  expect(parseBlocks("> the quoted line")).toEqual([
    { kind: "quote", text: "the quoted line" },
  ]);

  expect(parseBlocks("## What changed")).toEqual([
    { kind: "heading", level: 2, text: "What changed" },
  ]);

  expect(parseBlocks("above\n\n---\n\nbelow").map((block) => block.kind)).toEqual([
    "paragraph",
    "rule",
    "paragraph",
  ]);
});

test("bold, italic and inline code are tokens, and their markers are consumed", () => {
  const tokens = parseInline("**Bold** and *italic* and `code`");

  expect(tokens).toEqual([
    { kind: "bold", text: "Bold" },
    { kind: "text", text: " and " },
    { kind: "italic", text: "italic" },
    { kind: "text", text: " and " },
    { kind: "code", text: "code" },
  ]);

  const visible = tokens
    .filter((token) => token.kind === "text")
    .map((token) => token.text)
    .join("");

  expect(visible).not.toContain("*");
});

test("links are links only when they are http(s), and the label is kept", () => {
  expect(parseInline("see [the docs](https://example.com/a)")).toEqual([
    { kind: "text", text: "see " },
    { kind: "link", text: "the docs", href: "https://example.com/a" },
  ]);

  expect(parseInline("[x](javascript:alert(1))")).toEqual([
    { kind: "text", text: "[x](javascript:alert(1))" },
  ]);
});

test("paths and globs survive inline parsing untouched", () => {
  expect(parseInline("my_file_name.ts:12")).toEqual([
    { kind: "text", text: "my_file_name.ts:12" },
  ]);

  expect(parseInline("lib/*.ts")).toEqual([{ kind: "text", text: "lib/*.ts" }]);
});

test("a line directly above a list stays prose, and blank items are dropped", () => {
  expect(parseBlocks("Here is what I found:\n* first\n* second")).toEqual([
    { kind: "paragraph", text: "Here is what I found:" },
    { kind: "bullets", items: ["first", "second"] },
  ]);

  expect(parseBlocks("Steps:\n1. one\n2. two")).toEqual([
    { kind: "paragraph", text: "Steps:" },
    { kind: "ordered", items: ["one", "two"] },
  ]);

  expect(parseBlocks("* \n* real item")).toEqual([
    { kind: "bullets", items: ["real item"] },
  ]);
});

test("code keeps its asterisks, and an unclosed marker stays literal", () => {
  const blocks = parseBlocks('```ts\nconst s = "a*b*c";\n```');

  expect(blocks).toEqual([{ kind: "code", lang: "ts", text: 'const s = "a*b*c";' }]);

  expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
});
