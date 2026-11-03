import { AdSlot } from "@/components/AdSlot";

/**
 * A responsive banner pair: the leaderboard on a wide screen, the compact
 * banner on a phone. Only one is displayed, and both reserve their height, so
 * the page does not move when the ads arrive.
 */
export function AdBanner({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="hidden sm:block">
        <AdSlot slot="leaderboard" />
      </div>
      <div className="sm:hidden">
        <AdSlot slot="mobile" />
      </div>
    </div>
  );
}
