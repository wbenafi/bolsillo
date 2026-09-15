import { describe, expect, it } from "vitest";
import {
  applyReceiptToEmptyFields,
  transactionImpact,
  validateTransaction,
} from "./transaction-flow";
import { normalizeExtraction } from "./transaction-extraction";

const values = {
  type: "expense" as const,
  amount: "3200",
  description: "Mi compra",
  date: "2026-09-13",
  notes: "",
  tagIds: [],
};
const field = (value: unknown) => ({
  value,
  confidence: "high",
  reason: "Visible",
  evidence: { file: 1, page: 1, quote: "Ejemplo" },
});
const raw = {
  status: "ok",
  currency: "CRC",
  fields: {
    type: field("income"),
    amount: field("18500"),
    description: field("Del comprobante"),
    date: field("2026-09-12"),
    notes: field(null),
    tags: field(null),
  },
};

describe("movement review", () => {
  it("validates currency precision, real calendar dates and explicit amount review", () => {
    expect(
      validateTransaction(
        { ...values, amount: "3.20", date: "2026-02-30" },
        "CRC",
      ),
    ).toHaveProperty("date");
    expect(
      validateTransaction({ ...values, amount: "3.20" }, "CRC"),
    ).toEqual({});
    expect(validateTransaction({ ...values, amount: "3,20" }, "CRC")).toEqual({});
    expect(validateTransaction({ ...values, amount: "3.201" }, "CRC")).toHaveProperty("amount");
    expect(validateTransaction({ ...values, amount: "3,20" }, "USD")).toEqual(
      {},
    );
    expect(validateTransaction(values, "CRC", true)).toHaveProperty("amount");
    expect(validateTransaction(values, "CRC", false)).toEqual({});
  });
  it("computes edit impact by replacing the previous contribution", () => {
    expect(
      transactionImpact(10000, "expense", 3000, {
        type: "expense",
        amountMinor: 2000,
      }),
    ).toEqual({ delta: -1000, balance: 9000 });
    expect(
      transactionImpact(10000, "income", 3000, {
        type: "expense",
        amountMinor: 2000,
      }),
    ).toEqual({ delta: 5000, balance: 15000 });
  });
  it("does not overwrite user input when an extraction finishes late", () => {
    const result = normalizeExtraction(raw, "CRC", [], [1]);
    expect(applyReceiptToEmptyFields(values, result, [], [])).toEqual(values);
    expect(
      applyReceiptToEmptyFields(
        { ...values, amount: "", description: "" },
        result,
        ["description"],
        [],
      ),
    ).toMatchObject({ amount: "18500", description: "" });
  });
  it("never substitutes a foreign-currency amount", () => {
    const result = normalizeExtraction(
      { ...raw, currency: "USD" },
      "CRC",
      [],
      [1],
    );
    expect(
      applyReceiptToEmptyFields({ ...values, amount: "" }, result, [], [])
        .amount,
    ).toBe("");
  });
});
