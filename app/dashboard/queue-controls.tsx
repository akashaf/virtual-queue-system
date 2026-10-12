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
import { closeShopPlan, type OwnerQueue } from "@/lib/owner/view";
import { CHAIRS_STILL_BUSY } from "./messages";
import { MoveForm, type Move, type OwnerAction } from "./move-form";

/** The biggest thing on the board: the press the Owner makes between every haircut. */
export function CallNextButton({
  nobodyWaiting,
  move,
  call,
}: {
  nobodyWaiting: boolean;
  move: Move;
  call: OwnerAction;
}) {
  return (
    <MoveForm move={move} intent={{ kind: "call_next" }} action={call}>
      <Button
        type="submit"
        size="lg"
        className="h-14 w-full text-lg font-semibold"
        disabled={call.pending || nobodyWaiting}
      >
        Call next
      </Button>
    </MoveForm>
  );
}

/**
 * Last Call is confirmed: it pushes an alert to every Waiting Customer and
 * turns joiners away, which is not something to do with an elbow.
 */
export function StartLastCallButton({
  move,
  lastCall,
}: {
  move: Move;
  lastCall: OwnerAction;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 w-full">
          Last Call
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start last call?</AlertDialogTitle>
          <AlertDialogDescription>
            Stop new customers joining and ask waiting customers to choose?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">Not yet</AlertDialogCancel>
          <MoveForm
            move={move}
            intent={{ kind: "start_last_call" }}
            action={lastCall}
          >
            <AlertDialogAction
              type="submit"
              className="h-11 w-full"
              disabled={lastCall.pending}
            >
              Start last call
            </AlertDialogAction>
          </MoveForm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Reopening needs no confirmation: it takes nothing from anybody, and the
 * choices already made are kept for the next Last Call (§12 rule 2).
 */
export function ReopenJoiningButton({
  move,
  reopen,
}: {
  move: Move;
  reopen: OwnerAction;
}) {
  return (
    <MoveForm move={move} intent={{ kind: "cancel_last_call" }} action={reopen}>
      <Button
        type="submit"
        variant="outline"
        className="h-11 w-full"
        disabled={reopen.pending}
      >
        Reopen joining
      </Button>
    </MoveForm>
  );
}

/**
 * The confirmation counts what `close_shop` will actually do — or, while
 * anyone is still in a chair, says why it will refuse: those Tickets must be
 * finished first, because closing can neither bill them nor drop them.
 */
export function CloseShopButton({
  queue,
  move,
  close,
}: {
  queue: OwnerQueue;
  move: Move;
  close: OwnerAction;
}) {
  const chairsBusy = queue.called.length > 0;
  const plan = closeShopPlan(queue.waiting);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" className="h-11 w-full">
          Close Shop
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {chairsBusy ? "Customers still in the chair" : "Close the shop?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {chairsBusy
              ? CHAIRS_STILL_BUSY
              : `${plan.moving} moving to next day, ${plan.removing} will be removed.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">
            {chairsBusy ? "OK" : "Stay open"}
          </AlertDialogCancel>
          {chairsBusy ? null : (
            <MoveForm move={move} intent={{ kind: "close_shop" }} action={close}>
              <AlertDialogAction
                type="submit"
                variant="destructive"
                className="h-11 w-full"
                disabled={close.pending}
              >
                Close Shop
              </AlertDialogAction>
            </MoveForm>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
