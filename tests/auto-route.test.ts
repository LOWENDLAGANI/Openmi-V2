import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { AUTO_MODEL, MODELS, isModelId } from "../lib/models";
import {
  MODEL_REGISTRY,
  profileForModel,
  type ModelProfile,
} from "../lib/models/registry";
import { AUTO_ROUTES, BUILTIN_ROUTES } from "../lib/models/routes";
import { fitness, MAX_CHAIN_LENGTH, planChain } from "../lib/routing/chain";
import { classifyTask } from "../lib/routing/classify";
import {
  CONTINUATION_DIRECTIVE,
  LOOKAHEAD_CHARS,
  MIN_OVERLAP_CHARS,
  continuationMessages,
  overlapGate,
  type RoutedMessage,
} from "../lib/routing/continuation";
import {
  MAX_ROUTED_ATTEMPTS,
  streamRouted,
  type RoutedEvent,
  type RoutedTarget,
} from "../lib/routing/pipeline";

/**
 * Auto is a model with a queue behind it.
 *
 * These pin the three things that make that true: the request is read before a
 * model is chosen, the queue only holds models this deployment can call, and one
 * answer survives an endpoint failing halfway through it — without the reader
 * being told that anything happened.
 */

async function* chunks(...parts: Array<string | Error>): AsyncGenerator<string> {
  for (const part of parts) {
    if (part instanceof Error) throw part;
    yield part;
  }
}

const messages: RoutedMessage[] = [{ role: "user", content: "Explain the router." }];
const signal = () => new AbortController().signal;

function target(
  id: string,
  stream: (input: { messages: RoutedMessage[] }) => AsyncGenerator<string>
): RoutedTarget {
  return { id, stream: ({ messages: next }) => stream({ messages: next }) };
}

async function collect(options: {
  targets: RoutedTarget[];
  maxAttempts?: number;
  signal?: AbortSignal;
}): Promise<RoutedEvent[]> {
  const events: RoutedEvent[] = [];

  for await (const event of streamRouted({
    targets: options.targets,
    messages,
    signal: options.signal ?? signal(),
    maxAttempts: options.maxAttempts,
  })) {
    events.push(event);
  }

  return events;
}

const textOf = (events: RoutedEvent[]): string =>
  events.flatMap((event) => (event.type === "delta" ? [event.text] : [])).join("");

const settledOf = (events: RoutedEvent[]) =>
  events.find((event) => event.type === "settled");

// The routing modules are pure, so a test can import them. `lib/providers.ts` is
// server-only, so the wiring that joins Auto to it is read from source instead —
// the same way the runtime and composer tests guard their wiring.
const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("a request is classified before Auto chooses a model", () => {
  expect(classifyTask("Fix this TypeScript bug in src/app.ts")).toBe("coding");
  expect(
    classifyTask("Why does this fail? Compare the trade-offs and reason step by step.")
  ).toBe("reasoning");
  expect(classifyTask("What is the latest Node release today?")).toBe("search");
  expect(classifyTask("Open the page and click the submit form")).toBe("agent");
  expect(classifyTask("", { images: true })).toBe("vision");
  expect(classifyTask("")).toBe("general");
  expect(classifyTask("hello there")).toBe("general");
});

test("the pool holds capability profiles, and nothing secret", () => {
  expect(MODEL_REGISTRY).toHaveLength(50);

  const ids = MODEL_REGISTRY.map((profile) => profile.id);
  expect(new Set(ids).size).toBe(50);

  for (const id of ids) {
    expect(isModelId(id)).toBe(true);
  }

  const count = (tier: string) =>
    MODEL_REGISTRY.filter((profile) => profile.tier === tier).length;

  expect(count("coding")).toBe(5);
  expect(count("agent")).toBe(4);
  expect(count("reasoning")).toBe(18);
  expect(count("general")).toBe(23);

  expect(MODEL_REGISTRY.some((profile) => profile.vision)).toBe(true);
  expect(MODEL_REGISTRY.some((profile) => profile.search)).toBe(true);

  // A capability profile, never a route: no endpoint or key may appear in code.
  const code = source("../lib/models/registry.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  for (const token of ["http", "API_KEY", "endpoint", "Bearer"]) {
    expect(code.includes(token)).toBe(false);
  }
});

test("an alias finds the registry entry the catalogue already serves", () => {
  expect(profileForModel("deepseek-flash")?.id).toBe("deepseek-v4.1-flash-1017");
  expect(profileForModel("gpt-oss-120b")?.tier).toBe("general");
  expect(profileForModel("not-a-model")).toBeUndefined();
});

const PROBE: ModelProfile[] = [
  {
    id: "coder",
    tier: "coding",
    fits: ["coding"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "thinker",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "seer",
    tier: "general",
    fits: ["vision", "general"],
    vision: true,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "generalist",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
];

const probeIds = PROBE.map((profile) => profile.id);

test("Auto's queue orders by fit and only holds callable models", () => {
  const coding = planChain({ available: probeIds, task: "coding", registry: PROBE });

  expect(coding[0]).toBe("coder");
  expect(coding).toHaveLength(PROBE.length);

  // A model the deployment cannot call is not in the queue at all.
  expect(
    planChain({
      available: ["unknown-model", "coder"],
      task: "general",
      registry: PROBE,
    })
  ).toEqual(["coder"]);

  expect(
    planChain({ available: probeIds, task: "coding", registry: PROBE, limit: 2 })
  ).toHaveLength(2);

  expect(fitness(PROBE[0]!, "coding")).toBeGreaterThan(fitness(PROBE[3]!, "coding"));
});

test("a vision request never falls back to a model that cannot see", () => {
  const queue = planChain({ available: probeIds, task: "vision", registry: PROBE });

  expect(queue).toEqual(["seer"]);
});

test("the real pool plans a queue over the models this build can call", () => {
  const queue = planChain({
    available: ["codestral-latest", "gpt-4o"],
    task: "coding",
  });

  expect(queue[0]).toBe("codestral-latest");
  expect(queue.length).toBeLessThanOrEqual(MAX_CHAIN_LENGTH);
});

test("every UnoRouter route has a registry profile, so none is dropped", () => {
  const ids = Object.keys(AUTO_ROUTES);
  const queue = planChain({ available: ids, task: "general" });

  expect(queue).toHaveLength(ids.length);
  expect(new Set(queue)).toEqual(new Set(ids));
});

test("Auto's pool is the fifty UnoRouter free routes", () => {
  const routes = Object.entries(AUTO_ROUTES);

  expect(routes).toHaveLength(50);
  for (const [id, route] of routes) {
    expect(route.provider).toBe("openrouter");
    expect(route.upstream).toBe(`${id}:free`);
  }

  // The named DeepSeek model is a route of its own and is not in Auto's pool.
  // It is tried through Straitly first and falls back to direct DeepSeek.
  expect(AUTO_ROUTES["deepseek-flash"]).toBeUndefined();
  expect(BUILTIN_ROUTES["deepseek-flash"]).toEqual({
    provider: "straitly",
    upstream: "deepseek-v4-1-flash-1017",
  });

  // The pool never falls back to the direct DeepSeek provider.
  const providers = source("../lib/providers.ts");
  expect(providers).not.toContain("autoMaySpend");
  expect(providers).toContain("Object.keys(AUTO_ROUTES)");
  expect(providers).toContain('providerById("openrouter")');
});

test("Auto calls UnoRouter's OpenAI-compatible endpoint", () => {
  const providers = source("../lib/providers.ts");

  expect(providers).toContain("https://api.unorouter.com/v1/chat/completions");
  expect(providers).not.toContain("openrouter.ai");
});

test("Auto is a free catalogue entry, not a route", () => {
  const auto = MODELS.find((model) => model.id === AUTO_MODEL);

  expect(auto?.name).toBe("Auto");
  expect(auto?.category).toBe("general");
  // Free is a price: the hour still opens, it just costs nothing.
  expect(auto?.dewPerHour).toBe(0);

  // Auto is a router, so it has no registry profile of its own: a queue that
  // could contain Auto would be a loop.
  expect(profileForModel(AUTO_MODEL)).toBeUndefined();
});

test("Auto's queue is built from the UnoRouter pool, and Auto is never in it", () => {
  const providers = source("../lib/providers.ts");

  expect(providers).toContain("export function autoChain");
  expect(providers).toContain("Object.keys(AUTO_ROUTES)");
  expect(providers).toContain("classifyTask(prompt)");
  expect(providers).toContain("planChain(");

  // The named DeepSeek model falls back from Straitly to direct DeepSeek.
  expect(providers).toContain("export function providersFor");
  expect(providers).toContain('model === "deepseek-flash"');
  expect(providers).toContain('STRAITLY');
  expect(providers).toContain('"deepseek-v4-1-flash-1017"');
});

test("the chat route sends Auto through the pipeline and leaves the rest alone", () => {
  const route = source("../app/api/chat/route.ts");

  expect(route).toContain("model === AUTO_MODEL");
  expect(route).toContain("autoChain(prompt)");
  expect(route).toContain("streamRouted({");

  // A named model resolves to its provider chain and the loop tries it in order.
  expect(route).toContain("providersFor(model)");
  expect(route).toContain("for (const provider of chain)");
});

test("a tool turn only rotates while the step has produced nothing", () => {
  const agent = source("../lib/agent/run.ts");

  expect(agent).toContain("options.model === AUTO_MODEL");
  expect(agent).toContain("autoChain(");
  expect(agent).toContain("providerText.length > 0 || fragments.size > 0");
});

test("a continuation request carries the partial answer and the directive", () => {
  const base: RoutedMessage[] = [{ role: "user", content: "hi" }];
  const continued = continuationMessages(base, "Once upon a");

  expect(base).toHaveLength(1);
  expect(continued).toHaveLength(3);
  expect(continued[1]).toEqual({ role: "assistant", content: "Once upon a" });
  expect(continued[2]).toEqual({ role: "user", content: CONTINUATION_DIRECTIVE });

  expect(continuationMessages(base, "")).toEqual(base);
});

test("a replay from the top is trimmed and the new text survives", () => {
  const produced = "The router picks the best model.";
  const gate = overlapGate(produced);

  let output = "";
  for (const character of `${produced} And it explains why.`) {
    output += gate.push(character);
  }
  output += gate.flush();

  expect(output).toBe(" And it explains why.");
});

test("a repeat of the tail is trimmed", () => {
  const gate = overlapGate("First sentence. Second sentence.");

  let output = "";
  for (const character of "Second sentence. Third one.") {
    output += gate.push(character);
  }
  output += gate.flush();

  expect(output).toBe(" Third one.");
});

test("a short coincidence is kept, not trimmed", () => {
  const gate = overlapGate("The answer ends with X.");

  const output = gate.push("X. Next words here.") + gate.flush();

  expect(MIN_OVERLAP_CHARS).toBeGreaterThan("X.".length);
  expect(output).toBe("X. Next words here.");
});

test("with nothing produced the gate is a pass-through", () => {
  const gate = overlapGate("");

  expect(gate.push("hello")).toBe("hello");
  expect(gate.flush()).toBe("");
});

test("the gate holds less than a lookahead until it can decide", () => {
  const gate = overlapGate("The router picks the best model.");

  expect(gate.push("The r")).toBe("");
  expect("The r".length).toBeLessThan(LOOKAHEAD_CHARS);
  expect(gate.flush()).toBe("");
});

test("a failure before the first character is replaced silently", async () => {
  const events = await collect({
    targets: [
      target("a", () => chunks(new Error("rate limited"))),
      target("b", () => chunks("Hello")),
    ],
  });

  expect(textOf(events)).toBe("Hello");
  expect(settledOf(events)).toEqual({ type: "settled", complete: true, attempts: 2 });
  expect(textOf(events)).not.toContain("rate");
});

test("a mid-answer failure hands over the partial text and continues", async () => {
  let handed: RoutedMessage[] = [];

  const events = await collect({
    targets: [
      target("a", () => chunks("The router picks", new Error("stream reset"))),
      target("b", ({ messages: next }) => {
        handed = next;
        return chunks("The router picks the best model.");
      }),
    ],
  });

  expect(textOf(events)).toBe("The router picks the best model.");
  expect(settledOf(events)).toEqual({ type: "settled", complete: true, attempts: 2 });

  expect(handed).toHaveLength(messages.length + 2);
  expect(handed.at(-2)).toEqual({ role: "assistant", content: "The router picks" });
  expect(handed.at(-1)).toEqual({ role: "user", content: CONTINUATION_DIRECTIVE });

  // The instruction is context, never output.
  expect(textOf(events)).not.toContain("cut off");
});

test("a model that only repeats the partial text is not a continuation", async () => {
  const events = await collect({
    targets: [
      target("a", () => chunks("Answer", new Error("dropped"))),
      target("b", () => chunks("Answer")),
      target("c", () => chunks("Answer continued")),
    ],
  });

  expect(textOf(events)).toBe("Answer continued");
  expect(settledOf(events)).toEqual({
    type: "settled",
    complete: true,
    attempts: 3,
  });
});

test("running out of models keeps the partial answer and says it is partial", async () => {
  const events = await collect({
    targets: [
      target("a", () => chunks("Half an", new Error("dropped"))),
      target("b", () => chunks(new Error("rate limited"))),
    ],
  });

  expect(textOf(events)).toBe("Half an");
  expect(settledOf(events)).toEqual({
    type: "settled",
    complete: false,
    attempts: 2,
  });
});

test("the queue is attempted at most MAX_ROUTED_ATTEMPTS times", async () => {
  let opened = 0;
  let thrown: unknown = null;

  const many = Array.from({ length: 6 }, (_, index) =>
    target(`m${index}`, () => {
      opened += 1;
      return chunks(new Error("boom"));
    })
  );

  try {
    await collect({ targets: many });
  } catch (caught) {
    thrown = caught;
  }

  expect(opened).toBe(Math.min(MAX_ROUTED_ATTEMPTS, many.length));
  expect((thrown as Error).message).toBe("boom");
});

test("Stop is not a failover", async () => {
  const controller = new AbortController();
  controller.abort();

  let opened = 0;
  let thrown = false;

  try {
    await collect({
      signal: controller.signal,
      targets: [
        target("a", () => {
          opened += 1;
          return chunks(new Error("stopped"));
        }),
        target("b", () => {
          opened += 1;
          return chunks("This must not be asked for.");
        }),
      ],
    });
  } catch {
    thrown = true;
  }

  expect(thrown).toBe(true);
  expect(opened).toBe(1);
});

test("an empty queue is one clear failure, not an empty answer", async () => {
  let thrown: unknown = null;

  try {
    await collect({ targets: [] });
  } catch (caught) {
    thrown = caught;
  }

  expect(thrown).toBeInstanceOf(Error);
});
