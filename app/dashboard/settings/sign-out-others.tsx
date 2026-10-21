"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { ownerErrorMessage } from "../messages";
import { signOutOtherDevices } from "./actions";

/**
 * Sign out other devices: ends every Sign-in of the Owner but this one. It is
 * confirmed, because every other device the Owner uses, the counter tablet
 * included, needs the password again afterwards.
 */
export function SignOutOthers() {
  const [outcome, formAction, pending] = useActionState(signOutOtherDevices, null);

  return (
    <div className="flex flex-col gap-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="h-11 w-full" disabled={pending}>
            Sign out other devices
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out other devices?</AlertDialogTitle>
            <AlertDialogDescription>
              Sign out every other device? They&apos;ll need the password to get back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <form action={formAction}>
              <AlertDialogAction
                type="submit"
                variant="destructive"
                className="h-11 w-full"
                disabled={pending}
              >
                Sign out other devices
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {outcome?.ok ? (
        <Alert role="status">
          <CircleCheck aria-hidden />
          <AlertTitle className="line-clamp-none">Every other device is signed out.</AlertTitle>
        </Alert>
      ) : outcome ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">{ownerErrorMessage(outcome.reason)}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}
