import type { StatusTone } from "@/components/StatusPill";

/**
 * Shared validation, categories, statuses, and image signature checking for
 * bug/problem reports (`/report`) and feature suggestions (`/suggestions`).
 */

export type FeedbackKind = "bug" | "suggestion";

export type FeedbackStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "planned"
  | "closed";

export type FeedbackRow = {
  id: string;
  owner: string;
  kind: FeedbackKind;
  category: string;
  title: string;
  description: string;
  page_url: string | null;
  image_path: string | null;
  image_name: string | null;
  image_type: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const FEEDBACK_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const BUG_CATEGORIES = [
  { id: "agent", label: "Agent / Chat turns" },
  { id: "sandbox", label: "Linux Sandbox & Preview" },
  { id: "github", label: "GitHub Repo & Pull Requests" },
  { id: "billing", label: "Credit, Passes & Billing" },
  { id: "ui", label: "Interface & Layout" },
  { id: "other", label: "Other issue" },
] as const;

export const SUGGESTION_CATEGORIES = [
  { id: "feature", label: "New feature" },
  { id: "models", label: "Models & agent intelligence" },
  { id: "workflow", label: "GitHub & PR workflow" },
  { id: "ui", label: "UI / UX polish" },
  { id: "pricing", label: "Passes & Credit" },
  { id: "other", label: "Other idea" },
] as const;

export const FEEDBACK_STATUS_META: Record<
  FeedbackStatus,
  { label: string; tone: StatusTone }
> = {
  open: { label: "open", tone: "pending" },
  in_progress: { label: "in progress", tone: "pending" },
  planned: { label: "planned", tone: "ok" },
  resolved: { label: "resolved", tone: "ok" },
  closed: { label: "closed", tone: "optional" },
};

export function categoryLabel(kind: FeedbackKind, id: string): string {
  const list = kind === "bug" ? BUG_CATEGORIES : SUGGESTION_CATEGORIES;
  return list.find((item) => item.id === id)?.label ?? id;
}

function bytesAt(
  source: Uint8Array,
  offset: number,
  expected: number[]
): boolean {
  if (source.length < offset + expected.length) return false;
  return expected.every((byte, index) => source[offset + index] === byte);
}

function asciiAt(
  source: Uint8Array,
  offset: number,
  expected: string
): boolean {
  if (source.length < offset + expected.length) return false;

  for (let index = 0; index < expected.length; index += 1) {
    if (source[offset + index] !== expected.charCodeAt(index)) return false;
  }

  return true;
}

/**
 * Verifies that uploaded screenshot bytes match the declared PNG, JPEG, or WebP
 * signature so disguised HTML/scripts are rejected before reaching storage.
 */
export function feedbackImageBytesMatchType(
  bytes: Uint8Array,
  mime: string
): boolean {
  switch (mime) {
    case "image/png":
      return bytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return bytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP");
    default:
      return false;
  }
}
