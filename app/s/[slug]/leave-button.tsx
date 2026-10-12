import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Leaving is confirmed, in the chair as much as in the Queue: a mis-tap costs
 * the Customer their place, and the only way back is the QR code at the shop.
 */
export function LeaveButton({
  dict,
  onLeave,
  className,
}: {
  dict: Dictionary;
  onLeave: () => void;
  className?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-12 px-6 text-base text-destructive", className)}
        >
          {dict.leaveQueue}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dict.leaveConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{dict.leaveConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">{dict.leaveConfirmStay}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="h-11" onClick={onLeave}>
            {dict.leaveConfirmLeave}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
