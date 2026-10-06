import { Separator } from "@/components/ui/separator";
import type { App } from "../types";
import AppSelector from "./AppSelector";

type Props = { apps: App[]; selectedAppId: string | null; onSelectApp: (id: string | null) => void };

export default function Header({ apps, selectedAppId, onSelectApp }: Props) {
  return (
    <header className="col-span-2 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <img className="h-6" src="/tiny-sunny-logo.svg" alt="Tiny Sunny" />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
      <AppSelector apps={apps} selectedAppId={selectedAppId} onSelectApp={onSelectApp} />
    </header>
  );
}
