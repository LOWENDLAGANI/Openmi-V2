import { PageSkeleton } from "@/components/PageSkeleton";

/**
 * The fallback for any route without its own loading file. Next only shows it
 * while a segment resolves, which is exactly the moment a blank screen is worst.
 */
export default function Loading() {
  return <PageSkeleton rows={4} label="loading" />;
}
