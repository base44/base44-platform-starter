import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { App } from "../types";

type Props = { apps: App[]; selectedAppId: string | null; onSelectApp: (id: string | null) => void };

export default function AppSelector({ apps, selectedAppId, onSelectApp }: Props) {
  return (
    <>
      <Select value={selectedAppId ?? ""} onValueChange={onSelectApp}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Choose an app" />
        </SelectTrigger>
        <SelectContent>
          {apps.map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" onClick={() => onSelectApp(null)}>New app</Button>
    </>
  );
}
