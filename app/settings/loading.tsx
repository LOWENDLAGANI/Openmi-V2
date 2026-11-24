export default function SettingsLoading() {
  return (
    <div className="min-h-dvh bg-canvas">
      <div className="h-14 border-b border-line bg-canvas/85" />
      <main className="mx-auto w-full max-w-3xl space-y-5 px-5 py-8 sm:px-8">
        <div className="panel h-24 animate-pulse" />
        <div className="panel h-56 animate-pulse" />
        <div className="panel h-40 animate-pulse" />
      </main>
    </div>
  );
}
