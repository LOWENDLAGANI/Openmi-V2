import { PageSkeleton } from "@/components/PageSkeleton";

/** The balance and the receipt list are two reads before anything renders. */
export default function PayLoading() {
  return <PageSkeleton rows={5} label="loading plans" />;
}
