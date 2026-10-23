import { House, Share, SquarePlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_CUSTOMER_NAME_LENGTH, type NameProblem } from "@/lib/customer/view";
import { format, type Dictionary } from "@/lib/i18n";
import type { InstallGate } from "@/lib/install-gate";

/** The join form: the Customer's name, and the Join button the install gate may hold back. */
export function JoinForm({
  dict,
  shopName,
  waitingCount,
  name,
  onNameChange,
  nameProblem,
  ready,
  gate,
  onSubmit,
}: {
  dict: Dictionary;
  shopName: string;
  waitingCount: number;
  name: string;
  onNameChange: (value: string) => void;
  nameProblem: NameProblem | null;
  ready: boolean;
  /** "pending" until the browser can say whether this is a Home Screen app. */
  gate: InstallGate | "pending";
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{shopName}</h1>
        <p className="text-muted-foreground" aria-live="polite">
          {waitingCountLabel(waitingCount, dict)}
        </p>
      </div>

      {gate === "pending" ? null : gate !== "none" ? (
        <InstallSteps gate={gate} dict={dict} />
      ) : (
        <Card>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-name">{dict.nameLabel}</Label>
                <Input
                  id="customer-name"
                  name="name"
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder={dict.namePlaceholder}
                  // In UTF-16 units, which is what the attribute counts. An astral
                  // character is two of them, so this is the widest a 30-character
                  // name can be: a soft guard that can never refuse a valid name,
                  // with checkCustomerName as the real one.
                  maxLength={MAX_CUSTOMER_NAME_LENGTH * 2}
                  autoComplete="given-name"
                  enterKeyHint="go"
                  aria-invalid={nameProblem !== null}
                  aria-describedby="customer-name-privacy"
                  className="h-12 text-base"
                />
                {nameProblem ? (
                  <p role="alert" className="text-sm text-destructive">
                    {nameProblem === "required" ? dict.nameRequired : dict.nameTooLong}
                  </p>
                ) : null}
              </div>

              <p id="customer-name-privacy" className="text-sm text-muted-foreground">
                {dict.privacyNotice}
              </p>

              {/* So the browser's location prompt is not a surprise (frontend.md §3.2). */}
              <p className="text-sm text-muted-foreground">{dict.locationNotice}</p>

              <Button type="submit" size="lg" className="h-12 text-base" disabled={!ready}>
                {dict.joinButton}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * In place of the form on an iPhone that must join from the Home Screen
 * (frontend.md §3.2 step 0). The whole form goes, not just the button: a name
 * typed here would not follow the Customer into the installed app, which has
 * storage of its own.
 */
function InstallSteps({
  gate,
  dict,
}: {
  gate: Exclude<InstallGate, "none">;
  dict: Dictionary;
}) {
  const { title, help } =
    gate === "open_in_safari"
      ? { title: dict.openInSafariTitle, help: dict.openInSafariHelp }
      : { title: dict.installTitle, help: dict.installWhy };
  const steps: { icon: LucideIcon; text: string }[] = [
    { icon: Share, text: dict.installStepShare },
    { icon: SquarePlus, text: dict.installStepAdd },
    { icon: House, text: dict.installStepOpen },
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{help}</p>
        <ol className="flex flex-col gap-3">
          {steps.map(({ icon: Icon, text }, index) => (
            <li key={text} className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {index + 1}
              </span>
              <span className="flex-1">{text}</span>
              <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function waitingCountLabel(count: number, dict: Dictionary): string {
  if (count === 0) return dict.waitingNowNone;
  if (count === 1) return dict.waitingNowOne;
  return format(dict.waitingNow, { count });
}
