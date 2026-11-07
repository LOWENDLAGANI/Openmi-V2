/**
 * The markdown subset an answer is rendered with.
 *
 * Models answer in markdown whether or not they are asked to, and rendering
 * none of it left literal `**`, `*` and `##` in the transcript. Parsing all of
 * markdown would be a second product, so this handles what actually shows up:
 * headings, bullet and numbered lists, quotes, rules, fenced code, bold, italic,
 * inline code and links.
 *
 * Deliberately no HTML, no tables, no images, and no dependency: a model cannot
 * smuggle a tag the page did not ask for, and `_` is not an emphasis marker so
 * `my_file_name.ts:12` survives intact for the citation renderer.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "code"; text: string; lang: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const BULLET = /^\s{0,3}[*+-][ \t]+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,3}[.)][ \t]+(.*)$/;
const HEADING = /^\s{0,3}(#{1,4})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const QUOTE = /^\s{0,3}>[ \t]?(.*)$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const CONTINUATION = /^\s{2,}\S/;

/** A fence pair, then line parsing for everything between the fences. */
export function parseBlocks(content: string): Block[] {
  if (content.trim().length === 0) return [];

  const blocks: Block[] = [];
  const parts = content.split("```");

  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const newline = part.indexOf("\n");
      const lang = (newline === -1 ? "" : part.slice(0, newline)).trim();
      const body = newline === -1 ? part : part.slice(newline + 1);

      blocks.push({ kind: "code", text: body.replace(/\n$/, ""), lang });
      return;
    }

    blocks.push(...parseLines(part));
  });

  return blocks;
}

function parseLines(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  let bullets: string[] | null = null;
  let ordered: string[] | null = null;
  let quote: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n").trim() });
      paragraph = [];
    }

    if (bullets) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = null;
    }

    if (ordered) {
      blocks.push({ kind: "ordered", items: ordered });
      ordered = null;
    }

    if (quote) {
      blocks.push({ kind: "quote", text: quote.join(" ").trim() });
      quote = null;
    }
  };

  for (const line of lines) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: Math.min(4, heading[1].length) as 1 | 2 | 3 | 4,
        text: heading[2].trim(),
      });
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      // An intro line directly above a list is prose, not part of the list.
      if (paragraph.length > 0 || ordered || quote) flush();

      if (!bullets) bullets = [];
      if (bullet[1].trim().length > 0) bullets.push(bullet[1].trim());
      continue;
    }

    const step = line.match(ORDERED);
    if (step) {
      if (paragraph.length > 0 || bullets || quote) flush();

      if (!ordered) ordered = [];
      if (step[1].trim().length > 0) ordered.push(step[1].trim());
      continue;
    }

    const quoted = line.match(QUOTE);
    if (quoted) {
      if (paragraph.length > 0 || bullets || ordered) flush();

      if (!quote) quote = [];
      quote.push(quoted[1].trim());
      continue;
    }

    // A wrapped line belongs to the item it is wrapped inside.
    if (bullets && CONTINUATION.test(line)) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
      continue;
    }

    if (ordered && CONTINUATION.test(line)) {
      ordered[ordered.length - 1] += ` ${line.trim()}`;
      continue;
    }

    if (bullets || ordered || quote) flush();
    paragraph.push(line.trimEnd());
  }

  flush();
  return blocks;
}

/**
 * Inline markers, consumed rather than printed.
 *
 * A marker with no closing partner stays literal: a lone `*` or an unclosed
 * fence is more likely to be code than a formatting mistake.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (char === "*" && text[index + 1] === "*") {
      const end = text.indexOf("**", index + 2);
      const body = end === -1 ? "" : text.slice(index + 2, end);

      if (body.trim().length > 0 && !body.includes("\n")) {
        flush();
        out.push({ kind: "bold", text: body });
        index = end + 2;
        continue;
      }
    }

    if (char === "*") {
      const end = text.indexOf("*", index + 1);
      const body = end === -1 ? "" : text.slice(index + 1, end);

      if (
        body.trim().length > 0 &&
        !body.includes("\n") &&
        !body.startsWith(" ") &&
        !body.endsWith(" ")
      ) {
        flush();
        out.push({ kind: "italic", text: body });
        index = end + 1;
        continue;
      }
    }

    if (char === "[") {
      const close = text.indexOf("](", index + 1);
      if (close !== -1) {
        const paren = text.indexOf(")", close + 2);
        if (paren !== -1) {
          const label = text.slice(index + 1, close);
          const href = text.slice(close + 2, paren);

          if (label.length > 0 && /^https?:\/\//i.test(href)) {
            flush();
            out.push({ kind: "link", text: label, href });
            index = paren + 1;
            continue;
          }
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return out;
}

