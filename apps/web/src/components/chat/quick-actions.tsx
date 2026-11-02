import {
  ArrowRight,
  BookOpen,
  Calendar,
  CalendarCheck,
  CircleHelp,
  Clock,
  FileText,
  Inbox,
  Landmark,
  Mail,
  MapPin,
  Phone,
  Search,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import type { QuickAction } from "@rag-generator/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Icon names allowed in sources.json quickActions[].icon. Add to this map to use another lucide icon. */
const ICONS: Record<string, LucideIcon> = {
  UserRoundPlus,
  CalendarCheck,
  Inbox,
  MapPin,
  BookOpen,
  Calendar,
  CircleHelp,
  Clock,
  FileText,
  Landmark,
  Mail,
  Phone,
  Search,
};

export function QuickActions({ actions, onSelect, compact, disabled }: { actions: QuickAction[]; onSelect: (a: QuickAction) => void; compact: boolean; disabled?: boolean }) {
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex gap-2", compact ? "flex-wrap" : "grid grid-cols-2 sm:grid-cols-4")}>
      {actions.map((a) => {
        const Icon = ICONS[a.icon] ?? ArrowRight;
        return compact ? (
          <Button key={a.id} variant="outline" size="sm" disabled={disabled} onClick={() => onSelect(a)} className="rounded-full">
            <Icon /> {a.label}
          </Button>
        ) : (
          <Button key={a.id} variant="outline" disabled={disabled} onClick={() => onSelect(a)} className="h-auto flex-col items-start gap-2 p-3 text-left whitespace-normal">
            <span className="bg-accent text-accent-foreground flex size-8 items-center justify-center rounded-lg">
              <Icon className="size-4" />
            </span>
            <span className="text-sm leading-snug font-medium">{a.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
