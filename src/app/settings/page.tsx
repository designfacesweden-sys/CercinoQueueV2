"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SettingsCsvImport } from "./SettingsCsvImport";

function SettingsBody() {
  const searchParams = useSearchParams();
  const event = searchParams.get("event") ?? "";
  return <SettingsCsvImport eventId={event} />;
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full flex-1 items-center justify-center text-sm text-zinc-500">Loading…</div>
      }
    >
      <SettingsBody />
    </Suspense>
  );
}
