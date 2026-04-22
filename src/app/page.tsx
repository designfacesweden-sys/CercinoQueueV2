import { EventDashboard } from "@/components/EventDashboard";
import { Suspense } from "react";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-full flex-1 items-center justify-center bg-black px-4 py-8 text-sm text-zinc-500">
          Loading…
        </main>
      }
    >
      <EventDashboard />
    </Suspense>
  );
}
