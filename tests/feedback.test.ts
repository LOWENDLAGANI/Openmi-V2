import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  BUG_CATEGORIES,
  FEEDBACK_IMAGE_TYPES,
  SUGGESTION_CATEGORIES,
  categoryLabel,
  feedbackImageBytesMatchType,
} from "../lib/feedback";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("feedback image signature check validates PNG, JPEG, and WebP bytes", () => {
  expect(Object.keys(FEEDBACK_IMAGE_TYPES)).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const html = new TextEncoder().encode("<!doctype html><html></html>");

  expect(feedbackImageBytesMatchType(png, "image/png")).toBe(true);
  expect(feedbackImageBytesMatchType(jpeg, "image/jpeg")).toBe(true);
  expect(feedbackImageBytesMatchType(webp, "image/webp")).toBe(true);

  expect(feedbackImageBytesMatchType(html, "image/png")).toBe(false);
  expect(feedbackImageBytesMatchType(png, "image/jpeg")).toBe(false);
  expect(feedbackImageBytesMatchType(png, "application/pdf")).toBe(false);
});

test("bug and suggestion categories resolve labels cleanly", () => {
  expect(BUG_CATEGORIES.length).toBeGreaterThan(0);
  expect(SUGGESTION_CATEGORIES.length).toBeGreaterThan(0);
  expect(categoryLabel("bug", "sandbox")).toBe("Linux Sandbox & Preview");
  expect(categoryLabel("suggestion", "feature")).toBe("New feature");
});

test("report, suggestions, and admin feedback pages are wired with RLS migration", () => {
  const migration = read("supabase/migrations/059_user_feedback.sql");
  const reportPage = read("app/report/page.tsx");
  const suggestionsPage = read("app/suggestions/page.tsx");
  const adminFeedbackPage = read("app/admin/feedback/page.tsx");

  expect(migration).toContain("create table if not exists public.user_feedback");
  expect(migration).toContain("alter table public.user_feedback enable row level security");
  expect(migration).toContain("submit_user_feedback");
  expect(migration).toContain("review_user_feedback");

  expect(reportPage).toContain("submitBugReport");
  expect(reportPage).toContain('name="screenshot"');
  expect(suggestionsPage).toContain("submitSuggestion");
  expect(adminFeedbackPage).toContain("reviewFeedback");
});
