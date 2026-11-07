/**
 * Turning a request into an ordered queue for Auto.
 *
 * The queue is always built from models this deployment can actually call: a
 * profile in the registry is a candidate, and `available` is the permission.
 * That split is what stops a large pool from becoming a long queue of doomed
 * requests — an unconfigured model is skipped, not tried and failed.
 *
 * Auto has no model of its own, so the first entry is chosen by fit. Behind it
 * the rest of the queue stands in order, which is what the pipeline walks when
 * an endpoint drops.
 */

import type { ModelId } from "../models";
import {
  MODEL_REGISTRY,
  profileForModel,
  type ModelProfile,
  type RegistryTier,
  type TaskKind,
} from "../models/registry";

/** The tier a task asks for first. */
const TIER_FOR_TASK: Record<TaskKind, RegistryTier> = {
  coding: "coding",
  agent: "agent",
  search: "agent",
  reasoning: "reasoning",
  vision: "general",
  general: "general",
};

/** How many models a queue may hold. The pipeline only attempts the first few. */
export const MAX_CHAIN_LENGTH = 6;

/**
 * A model's fitness for one task, in points.
 *
 * Tier membership is the dominant term; being explicitly listed for the task
 * adds to it, and a search or computer-use request rewards a model that has a
 * live path of its own. Context size is a tie-break, not a reason to choose.
 */
export function fitness(profile: ModelProfile, task: TaskKind): number {
  let points = 0;

  if (profile.tier === TIER_FOR_TASK[task]) points += 100;

  const fit = profile.fits.indexOf(task);
  if (fit >= 0) points += 40 - fit * 5;

  if (task === "search" && profile.search) points += 25;
  if (task === "agent" && profile.search) points += 10;
  if (task === "agent" && profile.vision) points += 10;

  if (task === "coding" && profile.tier === "reasoning" && profile.fits.includes("coding")) {
    points += 5;
  }

  // At most one point, so it can only order equals.
  points += Math.min(profile.contextTokens, 1_100_000) / 1_100_000;

  return points;
}

/**
 * The queue for one Auto request.
 *
 * `available` is every id this deployment can call, in catalogue order. A vision
 * request returns only vision-capable models — falling back to a blind model
 * would produce a confident answer about an image it never saw, which is worse
 * than a short failure.
 */
export function planChain({
  preferred,
  available,
  task,
  limit = MAX_CHAIN_LENGTH,
  registry = MODEL_REGISTRY,
}: {
  preferred?: ModelId | null;
  available: readonly ModelId[];
  task: TaskKind;
  limit?: number;
  registry?: readonly ModelProfile[];
}): ModelId[] {
  const usable = new Set(available);
  const candidates: Array<{ id: ModelId; profile: ModelProfile; points: number; order: number }> = [];

  available.forEach((id) => {
    const profile = profileForModel(id, registry);
    if (!profile) return;
    if (task === "vision" && !profile.vision) return;

    candidates.push({
      id,
      profile,
      points: fitness(profile, task),
      order: registry.indexOf(profile),
    });
  });

  candidates.sort(
    (left, right) =>
      right.points - left.points ||
      right.profile.contextTokens - left.profile.contextTokens ||
      left.order - right.order
  );

  const queue: ModelId[] = [];

  const lead = preferred && usable.has(preferred) ? preferred : null;

  if (lead && (task !== "vision" || profileForModel(lead, registry)?.vision === true)) {
    queue.push(lead);
  }

  for (const candidate of candidates) {
    if (queue.length >= limit) break;
    if (queue.includes(candidate.id)) continue;
    queue.push(candidate.id);
  }

  return queue.slice(0, limit);
}
