import { expect, test } from "bun:test";

import { appendRunMessages } from "../lib/runs/store";

/**
 * The transcript a send copies onto its run.
 *
 * Migration 054 replaced one `append_run_message` call per row with a single
 * batched call. A deployment where that migration has not been pushed yet is
 * the interesting case: the batch does not exist, and the old behaviour has to
 * take over instead of the worker receiving an empty conversation.
 */

const RUN = "11111111-1111-4111-8111-111111111111";

const TRANSCRIPT = [
  { role: "user" as const, text: "first" },
  { role: "assistant" as const, text: "second" },
  { role: "user" as const, text: "third" },
];

type Row = { role: string; text: string };

function fakeAdmin(mode: "batch" | "absent" | "nothing") {
  const calls: string[] = [];
  const rows: Row[] = [];
  let index = 0;

  const admin = {
    calls,
    rows,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);

      if (name === "append_run_messages") {
        if (mode !== "batch") {
          return {
            data: null,
            error: {
              message:
                "Could not find the function public.append_run_messages(p_messages, p_run) in the schema cache",
            },
          };
        }

        const batch = args.p_messages as Array<{
          role: string;
          content: { text: string };
        }>;

        for (const message of batch) {
          rows.push({ role: message.role, text: message.content.text });
        }

        return { data: batch.length, error: null };
      }

      if (name === "append_run_message") {
        if (mode === "nothing") {
          return { data: null, error: { message: "no such function" } };
        }

        const content = args.p_content as { text: string };
        index += 1;
        rows.push({ role: String(args.p_role), text: content.text });
        return { data: index, error: null };
      }

      return { data: null, error: null };
    },
  };

  return admin;
}

const asClient = (admin: ReturnType<typeof fakeAdmin>) =>
  admin as unknown as Parameters<typeof appendRunMessages>[0];

test("the whole tail is one call when the batched function exists", async () => {
  const admin = fakeAdmin("batch");

  const written = await appendRunMessages(asClient(admin), RUN, TRANSCRIPT);

  expect(written).toBe(3);
  expect(admin.calls).toEqual(["append_run_messages"]);
  expect(admin.rows.map((row) => row.text)).toEqual(["first", "second", "third"]);
});

test("without migration 054 the rows are written one at a time, in order", async () => {
  const admin = fakeAdmin("absent");

  const written = await appendRunMessages(asClient(admin), RUN, TRANSCRIPT);

  expect(written).toBe(3);
  expect(admin.calls).toEqual([
    "append_run_messages",
    "append_run_message",
    "append_run_message",
    "append_run_message",
  ]);
  // Order is the contract: the worker builds its model call from these rows.
  expect(admin.rows.map((row) => row.text)).toEqual(["first", "second", "third"]);
  expect(admin.rows.map((row) => row.role)).toEqual([
    "user",
    "assistant",
    "user",
  ]);
});

test("a deployment with neither function loses history, not the send", async () => {
  const admin = fakeAdmin("nothing");

  const written = await appendRunMessages(asClient(admin), RUN, TRANSCRIPT);

  expect(written).toBe(0);
  expect(admin.rows).toEqual([]);
});
