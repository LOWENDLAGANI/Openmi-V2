import "server-only";

import { sandboxAccounts } from "./accounts";
import {
  listChatSandboxes,
  listRunSandboxes,
  type RemoteSandboxSummary,
} from "./provider";

/**
 * The whole estate, across every configured account.
 *
 * `provider.ts` answers questions about one account, because one account is all
 * a single sandbox needs. Reconciliation is the opposite question — "find every
 * box with no row" — and a box created under account B is invisible to a list
 * made with account A's key. So the sweeps ask here, and every summary carries
 * the account it was found under, which is the only key that can destroy it.
 *
 * Failures are isolated per account: a key that is wrong or rotated out must not
 * stop the other accounts from being reconciled. If every account fails, the
 * call throws — a sweep that silently sees nothing would delete the rows of
 * boxes it never looked at.
 */

async function acrossAccounts(
  fetch: (accountId: string, limit: number) => Promise<RemoteSandboxSummary[]>,
  limit: number
): Promise<RemoteSandboxSummary[]> {
  const accounts = sandboxAccounts();

  const found: RemoteSandboxSummary[] = [];
  let failed = 0;

  for (const account of accounts) {
    try {
      found.push(...(await fetch(account.id, limit)));
    } catch {
      failed += 1;
    }
  }

  if (found.length === 0 && failed > 0) {
    throw new Error(
      `No sandbox account could be listed (${failed} of ${accounts.length} failed).`
    );
  }

  return found.slice(0, limit);
}

export function listChatSandboxesEveryAccount(
  limit = 200
): Promise<RemoteSandboxSummary[]> {
  return acrossAccounts(listChatSandboxes, limit);
}

export function listRunSandboxesEveryAccount(
  limit = 200
): Promise<RemoteSandboxSummary[]> {
  return acrossAccounts(listRunSandboxes, limit);
}
