import { CircleAlert } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";

/** Why the Owner is still on this page: a refused sign-in or a Deactivated Shop. */
export function LoginNotice({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle className="line-clamp-none">{message}</AlertTitle>
    </Alert>
  );
}
