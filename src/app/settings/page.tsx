import NavBar from "@/components/NavBar";
import SettingsView from "@/components/SettingsView";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <NavBar />
      <SettingsView />
    </>
  );
}
