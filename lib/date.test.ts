import { describe, expect, it } from "vitest";

import { formatTransactionDate } from "./date";

describe("formatTransactionDate", () => {
  it("incluye el nombre del día en español", () => {
    expect(formatTransactionDate("2026-07-18")).toBe("sábado, 18 jul 2026");
  });

  it("mantiene la fecha indicada aunque el entorno use otra zona horaria", () => {
    expect(formatTransactionDate("2026-07-20")).toBe("lunes, 20 jul 2026");
  });
});
