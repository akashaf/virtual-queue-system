import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { endOtherSignIns } from "@/lib/auth/owner";
import {
  connectDb,
  createShop,
  resetTestData,
  sessionCount,
  signInAs,
  type OwnerClient,
} from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

/** Whether the Auth server still accepts this device's Sign-in, as the dashboard layout asks. */
async function stillSignedIn(client: OwnerClient): Promise<boolean> {
  const { error } = await client.auth.getUser();
  return error === null;
}

describe("Sign out other devices (#34)", () => {
  test("ends every other Sign-in of the Owner and keeps the device in hand", async () => {
    const { owner } = await createShop();
    const lostPhone = await signInAs(owner.email, owner.password);
    const formerStaffTablet = await signInAs(owner.email, owner.password);
    const counter = await signInAs(owner.email, owner.password);

    expect(await endOtherSignIns(counter)).toBe("done");

    expect(await stillSignedIn(lostPhone)).toBe(false);
    expect(await stillSignedIn(formerStaffTablet)).toBe(false);
    expect(await stillSignedIn(counter)).toBe(true);
    expect(await sessionCount(db, owner.email)).toBe(1);
  });

  test("leaves another Owner's Sign-ins alone", async () => {
    const { owner } = await createShop();
    const { owner: neighbour } = await createShop();
    const counter = await signInAs(owner.email, owner.password);
    const neighbourCounter = await signInAs(neighbour.email, neighbour.password);

    expect(await endOtherSignIns(counter)).toBe("done");

    expect(await stillSignedIn(neighbourCounter)).toBe(true);
  });

  test("says so when the device is no longer signed in itself", async () => {
    const { owner } = await createShop();
    const phone = await signInAs(owner.email, owner.password);
    const counter = await signInAs(owner.email, owner.password);
    await endOtherSignIns(phone);

    expect(await endOtherSignIns(counter)).toBe("signed_out");
    expect(await stillSignedIn(phone)).toBe(true);
  });
});
