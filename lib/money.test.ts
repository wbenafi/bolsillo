import { describe, expect, it } from "vitest";

import { calculateWalletTotals, formatMoney, parseMoneyInput } from "./money";

describe("calculateWalletTotals", () => {
  it("calcula ingresos, gastos y saldo positivo", () => {
    expect(calculateWalletTotals([
      { type: "income", amountMinor: 5_000_000 },
      { type: "expense", amountMinor: 185_000 },
      { type: "expense", amountMinor: 350_000 },
      { type: "income", amountMinor: 1_000_000 },
    ])).toEqual({ totalIncome: 6_000_000, totalExpense: 535_000, balance: 5_465_000 });
  });

  it("calcula saldo cero", () => {
    expect(calculateWalletTotals([
      { type: "income", amountMinor: 1000 },
      { type: "expense", amountMinor: 1000 },
    ]).balance).toBe(0);
  });

  it("calcula saldo negativo", () => {
    expect(calculateWalletTotals([
      { type: "income", amountMinor: 500 },
      { type: "expense", amountMinor: 1200 },
    ]).balance).toBe(-700);
  });
});

describe("formatMoney", () => {
  it("formatea CRC sin decimales", () => {
    expect(formatMoney(10_000, "CRC").replace(/\s/g, "")).toMatch(/₡10[.\u00a0]?000/);
  });

  it("formatea USD con dos decimales", () => {
    expect(formatMoney(123_45, "USD")).toContain("123,45");
  });
});

describe("parseMoneyInput", () => {
  it("convierte CRC a unidades enteras", () => {
    expect(parseMoneyInput("10000", "CRC")).toBe(10_000);
  });

  it("convierte USD a centavos sin punto flotante acumulativo", () => {
    expect(parseMoneyInput("123,45", "USD")).toBe(12_345);
  });

  it("rechaza montos inválidos, cero y decimales no soportados", () => {
    expect(parseMoneyInput("0", "CRC")).toBeNull();
    expect(parseMoneyInput("10.5", "CRC")).toBeNull();
    expect(parseMoneyInput("hola", "USD")).toBeNull();
  });
});
