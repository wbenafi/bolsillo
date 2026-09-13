import { describe, expect, it } from "vitest";

import { calculateWalletTotals, formatMoney, moneyInputValue, parseMoneyInput } from "./money";

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
  it("formatea CRC con dos decimales", () => {
    expect(formatMoney(1_000_050, "CRC").replace(/\s/g, "")).toBe("₡10000,50");
  });

  it("formatea USD con dos decimales", () => {
    expect(formatMoney(123_45, "USD")).toContain("123,45");
  });
});

describe("parseMoneyInput", () => {
  it("convierte CRC a centésimos enteros", () => {
    expect(parseMoneyInput("10000", "CRC")).toBe(1_000_000);
  });

  it("convierte USD a centavos sin punto flotante acumulativo", () => {
    expect(parseMoneyInput("123,45", "USD")).toBe(12_345);
  });

  it("rechaza montos inválidos, cero y decimales no soportados", () => {
    expect(parseMoneyInput("0", "CRC")).toBeNull();
    expect(parseMoneyInput("10.555", "CRC")).toBeNull();
    expect(parseMoneyInput("hola", "USD")).toBeNull();
  });
});

describe("decimal money and historical data", () => {
  it.each(["CRC", "USD"] as const)("round trips exact hundredths for %s", currency => {
    for (const [input, minor] of [["45181.50", 4518150], ["45181,5", 4518150], ["45181.00", 4518100], ["0.01", 1], ["0,50", 50], ["45 181,50", 4518150], ["45\u00a0181,50", 4518150]] as const) {
      expect(parseMoneyInput(input, currency)).toBe(minor);
      expect(parseMoneyInput(moneyInputValue(minor, currency), currency)).toBe(minor);
    }
    expect(moneyInputValue(4518150, currency)).toBe("45181.50");
    expect(moneyInputValue(-1, currency)).toBe("-0.01");
    expect(formatMoney(-1, currency).replace(/\s/g, "")).toMatch(/^-.*0,01$/);
    expect(formatMoney(0, currency)).toContain("0,00");
  });
  it.each(["1,000", "1.000", "45.181,50", "45,181.50", "1 2", "1e3", "NaN", "Infinity", "-1", "0", "0.0001", "10.", "1\n000"])("rejects ambiguous or invalid input %s", input => {
    expect(parseMoneyInput(input, "CRC")).toBeNull();
  });
  it("keeps exact cents at the integer precision boundary and rejects overflow", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(parseMoneyInput("90071992547409.91", "CRC")).toBe(max);
    expect(moneyInputValue(max, "CRC")).toBe("90071992547409.91");
    expect(formatMoney(max, "CRC").replace(/\s/g, "")).toBe("₡90071992547409,91");
    expect(parseMoneyInput("90071992547409.92", "CRC")).toBeNull();
    expect(() => calculateWalletTotals([{ type: "income", amountMinor: max }, { type: "income", amountMinor: 1 }])).toThrow("precisión");
  });
  it("adds fractional amounts exactly, including a negative balance", () => {
    expect(calculateWalletTotals([
      { type: "income", amountMinor: parseMoneyInput("0.10", "CRC")! },
      { type: "income", amountMinor: parseMoneyInput("0.20", "CRC")! },
      { type: "expense", amountMinor: parseMoneyInput("0.31", "CRC")! },
    ])).toEqual({ totalIncome: 30, totalExpense: 31, balance: -1 });
  });
});
