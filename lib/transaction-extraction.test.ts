import { describe, expect, it } from "vitest";
import { normalizeExtraction, parseExtractionResponse, validISODate } from "./transaction-extraction";
function receipt() {
  const field = (value: unknown) => ({ value, confidence: "high", reason: "Visible", evidence: { file: 1, page: 1, quote: "Factura" } });
  return { status: "ok", currency: "CRC", fields: { type: field("expense"), amount: field("18500"), description: field("Materiales"), date: field("2026-09-12"), notes: field(null), tags: field(["Casa", "Inventado"]) } };
}
describe("receipt extraction validation", () => {
  it("preserves printed CRC totals including fractional colones without rounding", () => {
    const input = receipt(); input.fields.amount.value = "45181.00";
    const result = normalizeExtraction(input, "CRC", [], [1]);
    expect(result.fields.amount.value).toBe("45181.00");
    expect(result.fields.amount.confidence).toBe("high");
    expect(normalizeExtraction(result, "CRC", [], [1]).fields.amount.value).toBe("45181.00");
    input.fields.amount.value = "45181.50";
    expect(normalizeExtraction(input, "CRC", [], [1]).fields.amount.value).toBe("45181.50");
    expect(normalizeExtraction(input, "CRC", [], [1]).status).toBe("ok");
  });
  it("keeps usable receipt fields when another provider field is malformed", () => {
    const input = receipt(); input.fields.date.value = "December 7";
    const parsed = parseExtractionResponse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const result = normalizeExtraction(parsed.data, "CRC", [], [1]);
    expect(result.status).toBe("partial");
    expect(result.fields.date.value).toBeNull();
    expect(result.fields.amount.value).toBe("18500");
  });
  it("accepts numeric JSON amounts without converting a foreign receipt into local money", () => {
    const input = receipt(); input.currency = "USD"; input.fields.amount.value = 4.95;
    const parsed = parseExtractionResponse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const result = normalizeExtraction(parsed.data, "CRC", [], [1]);
    expect(result.currencyMismatch).toBe(true);
    expect(result.fields.amount.value).toBe("4.95");
  });
  it("still rejects invalid envelopes and results with no usable fields", () => {
    expect(parseExtractionResponse({ status: "ok", fields: {} }).success).toBe(false);
    expect(parseExtractionResponse({ ...receipt(), status: "invented" }).success).toBe(false);
    expect(parseExtractionResponse("not JSON").success).toBe(false);
  });
  it("preserves useful data and only suggests existing tags", () => {
    const result = normalizeExtraction(receipt(), "CRC", ["Casa"], [1]);
    expect(result.fields.amount.value).toBe("18500"); expect(result.fields.tags.value).toEqual(["Casa"]);
    expect(result.fields.notes.confidence).toBe("unknown");
  });
  it("rejects fabricated evidence and invalid dates regardless of confidence", () => {
    const input = receipt(); input.fields.amount.evidence.page = 9; input.fields.date.value = "2026-02-30";
    const result = normalizeExtraction(input, "CRC", [], [1]);
    expect(result.fields.amount.confidence).toBe("low"); expect(result.fields.amount.evidence).toBeNull(); expect(result.fields.date.value).toBeNull();
    expect(validISODate("2024-02-29")).toBe(true); expect(validISODate("2025-02-29")).toBe(false);
  });
  it("never treats a foreign amount as a local amount", () => {
    const input = receipt(); input.currency = "USD"; input.fields.amount.value = "12.50";
    const result = normalizeExtraction(input, "CRC", [], [1]);
    expect(result.currencyMismatch).toBe(true); expect(result.fields.amount.value).toBe("12.50");
  });
  it("rejects invalid money and unknown confidence values", () => {
    const input = receipt(); input.fields.amount.value = "0";
    expect(normalizeExtraction(input, "CRC", [], [1]).fields.amount.value).toBeNull();
    input.fields.amount.confidence = "100%";
    expect(() => normalizeExtraction(input, "CRC", [], [1])).toThrow();
  });
  it("unknown confidence never autofills a guessed value", () => {
    const input = receipt(); input.fields.description.confidence = "unknown";
    expect(normalizeExtraction(input, "CRC", [], [1]).fields.description.value).toBeNull();
  });
});
