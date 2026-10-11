import { PlusIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { App } from "../server/base44";

type Props = { apps: App[]; selectedAppId: string | null; onSelectApp: (id: string | null) => void };

// One menu for both: start a new app, or open one of yours.
export default function AppSelector({ apps, selectedAppId, onSelectApp }: Props) {
  return (
    <Select value={selectedAppId ?? "new"} onValueChange={(id) => onSelectApp(id === "new" ? null : id)}>
      <SelectTrigger className="app-selector">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="app-selector-menu">
        <SelectItem value="new">
          <PlusIcon /> New app
        </SelectItem>
        {apps.length > 0 && <SelectSeparator />}
        {apps.map((app) => (
          <SelectItem key={app.id} value={app.id}>
            <span className="app-selector-name">{app.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
