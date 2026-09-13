import { ConvexError, v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { currencyValidator } from "./schema";
import { addMoney } from "../lib/money";

const migrationName = "2026-09-crc-hundredths";

/** One-time maintenance operation; never called by the application.
 * Pass the monetary snapshot from the pre-migration backup. All checks, patches,
 * and the completion receipt share one transaction, so retries cannot rescale.
 */
export const migrateCrcToHundredths = internalMutation({
  args: {
    expectedTransactions: v.array(v.object({
      transactionId: v.id("transactions"),
      walletId: v.id("wallets"),
      currency: currencyValidator,
      amountMinor: v.number(),
      updatedAt: v.number(),
    })),
  },
  handler: async (ctx, { expectedTransactions }) => {
    const completed = await ctx.db.query("dataMigrations")
      .withIndex("by_name", q => q.eq("name", migrationName)).unique();
    if (completed) return { alreadyApplied: true, transactionCount: completed.transactionCount, crcCount: completed.crcCount, usdCount: completed.usdCount };

    // Deliberately bounded for this small database. Refuse a larger dataset
    // instead of attempting an unbounded maintenance mutation.
    const transactions = await ctx.db.query("transactions").take(1001);
    const expected = new Map(expectedTransactions.map(t => [t.transactionId, t]));
    if (transactions.length > 1000 || transactions.length !== expectedTransactions.length || expected.size !== expectedTransactions.length) {
      throw new ConvexError("La cantidad de movimientos no coincide con el respaldo o excede el límite de esta migración.");
    }

    const changes: Array<{ id: typeof transactions[number]["_id"]; amountMinor: number }> = [];
    const totals = new Map<string, number>();
    for (const transaction of transactions) {
      const snapshot = expected.get(transaction._id);
      const wallet = await ctx.db.get(transaction.walletId);
      if (!snapshot || !wallet || snapshot.walletId !== transaction.walletId || snapshot.currency !== wallet.currency || snapshot.amountMinor !== transaction.amountMinor || snapshot.updatedAt !== transaction.updatedAt) {
        throw new ConvexError("Los movimientos cambiaron desde el respaldo. Revisá los datos antes de migrar.");
      }
      const amount = transaction.amountMinor * (wallet.currency === "CRC" ? 100 : 1);
      if (!Number.isSafeInteger(transaction.amountMinor) || transaction.amountMinor <= 0 || !Number.isSafeInteger(amount)) {
        throw new ConvexError("Un monto no se puede convertir con precisión. No se modificó ningún movimiento.");
      }
      const totalKey = `${wallet._id}:${transaction.type}`;
      totals.set(totalKey, addMoney(totals.get(totalKey) ?? 0, amount));
      if (wallet.currency === "CRC") changes.push({ id: transaction._id, amountMinor: amount });
    }

    // Preserve IDs, descriptions, dates, revisions, files, and timestamps.
    for (const change of changes) await ctx.db.patch(change.id, { amountMinor: change.amountMinor });
    const counts = { transactionCount: transactions.length, crcCount: changes.length, usdCount: transactions.length - changes.length };
    await ctx.db.insert("dataMigrations", { name: migrationName, completedAt: Date.now(), ...counts });
    return { alreadyApplied: false, ...counts };
  },
});
