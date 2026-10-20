import { CircleAlert, Info } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";

/**
 * Why the Owner is still on this page. A refused sign-in is an error; a
 * Deactivated Shop is not the Owner's mistake, so it is said calmly.
 */
export function LoginNotice({
  id,
  message,
  error,
}: {
  id: string;
  message: string;
  error: boolean;
}) {
  const Icon = error ? CircleAlert : Info;
  return (
    // An error interrupts; the calm notice waits its turn.
    <Alert id={id} variant={error ? "destructive" : "default"} role={error ? "alert" : "status"}>
      <Icon aria-hidden />
      <AlertTitle className="line-clamp-none">{message}</AlertTitle>
    </Alert>
  );
}
