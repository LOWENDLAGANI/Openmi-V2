import { PageSkeleton } from "@/components/PageSkeleton";

/** The ledger and per-chat usage are database reads, so the frame comes first. */
export default function ActivityLoading() {
  return <PageSkeleton rows={4} />;
}
