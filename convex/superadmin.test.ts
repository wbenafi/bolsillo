import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function registeredUser(
  t: TestConvex<typeof schema>,
  externalId: string,
  profile?: { name?: string; email?: string },
) {
  const asUser = t.withIdentity({
    subject: externalId,
    tokenIdentifier: `https://clerk.test|${externalId}`,
    ...profile,
  });
  await asUser.mutation(api.users.ensureCurrent, {});
  const viewer = await asUser.query(api.users.current, {});
  if (!viewer) throw new Error("Expected a registered viewer");
  return { asUser, viewer };
}

async function promoteToSuperadmin(t: TestConvex<typeof schema>, externalId: string) {
  await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    if (!user) throw new Error("Expected a user to promote");
    await ctx.db.patch(user._id, { platformRole: "superadmin" });
  });
}

describe("superadmin authorization", () => {
  it("denies the account directory to regular users", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await registeredUser(t, "user_member", { email: "member@example.com" });

    await expect(asUser.query(api.superadmin.overview, {})).rejects.toThrow(
      "No tenés permiso",
    );
  });

  it("suspends an account and enforces the status in normal wallet queries", async () => {
    const t = convexTest(schema, modules);
    const { asUser: asAdmin } = await registeredUser(t, "user_admin", {
      name: "Admin",
      email: "admin@example.com",
    });
    await promoteToSuperadmin(t, "user_admin");
    const { asUser: asMember, viewer: member } = await registeredUser(t, "user_target", {
      name: "Target",
      email: "target@example.com",
    });
    await asMember.mutation(api.wallets.createWallet, {
      name: "Ahorros",
      currency: "CRC",
    });

    await asAdmin.mutation(api.superadmin.setAccountStatus, {
      accountId: member.account._id,
      status: "suspended",
      reason: "Revisión administrativa",
    });

    await expect(asMember.query(api.wallets.listActiveWallets, {})).rejects.toThrow(
      "Esta cuenta está suspendida",
    );
    const audit = await t.run(async (ctx) => await ctx.db.query("adminAuditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "account.suspended" });
  });

  it("enforces feature overrides in mutations and protects the final superadmin", async () => {
    const t = convexTest(schema, modules);
    const { asUser: asAdmin, viewer: admin } = await registeredUser(t, "user_admin");
    await promoteToSuperadmin(t, "user_admin");
    const { asUser: asMember, viewer: member } = await registeredUser(t, "user_member");
    const walletId = await asMember.mutation(api.wallets.createWallet, {
      name: "Proyecto",
      currency: "USD",
    });

    await asAdmin.mutation(api.superadmin.setFeatureOverride, {
      accountId: member.account._id,
      featureKey: "transactions.manage",
      enabled: false,
    });

    await expect(
      asMember.mutation(api.transactions.createTransaction, {
        walletId,
        type: "income",
        amountMinor: 1000,
        description: "Ingreso",
        date: "2026-08-30",
      }),
    ).rejects.toThrow("Esta función no está habilitada");

    await expect(
      asAdmin.mutation(api.superadmin.setPlatformRole, {
        userId: admin.user._id,
        role: "member",
      }),
    ).rejects.toThrow("al menos un superadmin");
  });
});
