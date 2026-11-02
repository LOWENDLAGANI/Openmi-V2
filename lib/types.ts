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
