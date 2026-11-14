import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-subtle p-3 text-muted">
        <Inbox className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
