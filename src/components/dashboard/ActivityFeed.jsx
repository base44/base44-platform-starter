import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Activity } from "lucide-react";

export default function ActivityFeed({ items, isLoading }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-muted-foreground" />
        Recent activity
      </h3>
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        {isLoading ? (
          <div className="space-y-3">
            {Array(3)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-3 w-full mb-1" />
                    <Skeleton className="h-2.5 w-16" />
                  </div>
                </div>
              ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(item.updated_date), "MMM d, h:mm a")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
