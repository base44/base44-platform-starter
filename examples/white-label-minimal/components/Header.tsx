import Image from "next/image";
import { Separator } from "@/components/ui/separator";
import type { App } from "../server/base44";
import AppSelector from "./AppSelector";
import logo from "../public/tiny-sunny-logo.svg";

type Props = { apps: App[]; selectedAppId: string | null; onSelectApp: (id: string | null) => void };

export default function Header({ apps, selectedAppId, onSelectApp }: Props) {
  return (
    <header className="header">
      <Image className="header-logo" src={logo} alt="Tiny Sunny" preload />
      <Separator orientation="vertical" className="header-divider" />
      <AppSelector apps={apps} selectedAppId={selectedAppId} onSelectApp={onSelectApp} />
    </header>
  );
}
