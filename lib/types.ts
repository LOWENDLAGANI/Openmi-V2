export type Folder = {
  id: string;
  name: string;
  created_at: string;
};

export type Chat = {
  id: string;
  title: string;
  folder_id: string | null;
  repo_full_name: string | null;
  repo_branch: string | null;
  repo_base_sha: string | null;
  model: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * One thing the model did while producing an answer.
 *
 * A step is a sentence, not a log line: the command and its output ride along
 * so the transcript can fold them open, and the state says whether the step is
 * still running, finished, or failed. Stored with the answer it produced, so a
 * reload shows the same work the tab watched.
 */
export type AgentStep = {
  tool: string;
  detail: string;
  state: "start" | "done" | "error";
  command?: string;
  output?: string;
  /**
   * Characters of the answer already written when this step ran.
   *
   * Recorded by the tab watching the turn, so the console can sit inside the
   * text where it happened instead of above an answer it interrupts. Stored
   * rows do not carry it: the answer kept for a finished run is only the last
   * stretch the model wrote, so a step's place in it is the top.
   */
  at?: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  seq: number;
  usage_tokens: number | null;
  created_at: string;
  /** The chain of thought behind this answer, when the model streamed one. */
  thinking?: string | null;
  /** What the model did before it answered. */
  steps?: AgentStep[] | null;
};
