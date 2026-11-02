import { PageSkeleton } from "@/components/PageSkeleton";

/** The setup page probes live services before it can report anything. */
export default function SetupLoading() {
  return <PageSkeleton rows={5} />;
}
