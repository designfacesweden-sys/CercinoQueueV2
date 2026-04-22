import { SettingsCsvImport } from "./SettingsCsvImport";

type PageProps = {
  searchParams: Promise<{ event?: string }>;
};

export default async function SettingsPage(props: PageProps) {
  const sp = await props.searchParams;
  const event = typeof sp.event === "string" ? sp.event : "";
  return <SettingsCsvImport eventId={event} />;
}
