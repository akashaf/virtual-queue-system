import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_CUSTOMER_NAME_LENGTH, type NameProblem } from "@/lib/customer/view";
import { format, type Dictionary } from "@/lib/i18n";

export function JoinForm({
  dict,
  shopName,
  waitingCount,
  name,
  onNameChange,
  nameProblem,
  ready,
  onSubmit,
}: {
  dict: Dictionary;
  shopName: string;
  waitingCount: number;
  name: string;
  onNameChange: (value: string) => void;
  nameProblem: NameProblem | null;
  ready: boolean;
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

            <Button type="submit" size="lg" className="h-12 text-base" disabled={!ready}>
              {dict.joinButton}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function waitingCountLabel(count: number, dict: Dictionary): string {
  if (count === 0) return dict.waitingNowNone;
  if (count === 1) return dict.waitingNowOne;
  return format(dict.waitingNow, { count });
}
