import { describe, expect, it } from "vitest";

import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("extracts structured Convex error messages", () => {
    expect(errorMessage(new Error(
      'Server Error Uncaught ConvexError: {"code":"R2_NOT_CONFIGURED","message":"Configurá R2."}',
    ))).toBe("Configurá R2.");
  });

  it("uses Convex error data when it is available", () => {
    expect(errorMessage({ data: { code: "DENIED", message: "Sin permiso." } })).toBe("Sin permiso.");
  });

  it("preserves ordinary error messages", () => {
    expect(errorMessage(new Error("Falló la carga."))).toBe("Falló la carga.");
  });
});
