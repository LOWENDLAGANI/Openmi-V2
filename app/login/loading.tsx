import { PageSkeleton } from "@/components/PageSkeleton";

/**
 * The landing page's primary call to action points here.
 *
 * Sign-in reads the session and, when the deployment is configured, the
 * providers it can offer, so the first paint is a server round trip. The
 * skeleton matches that page's shape rather than showing a blank document.
 */
export default function LoginLoading() {
  return <PageSkeleton rows={3} label="signing in" width="max-w-md" />;
}
