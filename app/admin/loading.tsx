import { PageSkeleton } from "@/components/PageSkeleton";

/** The admin queue reads requests, profiles and signed receipt links. */
export default function AdminLoading() {
  return <PageSkeleton rows={6} label="loading the queue" width="max-w-5xl" />;
}
