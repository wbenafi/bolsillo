import { describe, expect, it } from "vitest";

import type { WalletTransaction } from "../types/domain";
import { transactionsForWalletShare, walletShareFilename } from "./wallet-share-image";

describe("wallet share image", () => {
  it("includes at most the 10 most recent transactions in their current order", () => {
    const transactions = Array.from({ length: 12 }, (_, index) => ({
      description: `Movimiento ${index + 1}`,
    })) as WalletTransaction[];

    expect(transactionsForWalletShare(transactions)).toHaveLength(10);
    expect(transactionsForWalletShare(transactions).map(({ description }) => description)).toEqual(
      transactions.slice(0, 10).map(({ description }) => description),
    );
  });

  it("creates a safe and recognizable PNG filename", () => {
    expect(walletShareFilename("Construcción de la casa")).toBe("bolsillo-construccion-de-la-casa.png");
    expect(walletShareFilename("!!!")).toBe("bolsillo-resumen.png");
  });
});
