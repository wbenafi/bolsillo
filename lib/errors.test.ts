import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { errorCode, errorMessage } from "./errors";

describe("Convex error recovery", () => {
  it("recognizes an expired upload from a structured action error", () => {
    const error = new ConvexError({
      code: "UPLOAD_EXPIRED",
      message: "La carga venció.",
    });
    expect(errorCode(error)).toBe("UPLOAD_EXPIRED");
    expect(errorMessage(error)).toBe("La carga venció.");
  });

  it("recognizes a removed batch wrapped by an action's nested query", () => {
    const error = new Error(
      'Server Error\nUncaught Error: nested query failed\nUncaught ConvexError: {"code":"UPLOAD_NOT_FOUND","message":"La carga ya no está disponible."}',
    );
    expect(errorCode(error)).toBe("UPLOAD_NOT_FOUND");
    expect(errorMessage(error)).toBe("La carga ya no está disponible.");
  });

  it("leaves transport failures retryable when the commit outcome is unknown", () => {
    for (const error of [
      new Error("Connection lost"),
      new Error("Uncaught ConvexError: invalid"),
      null,
      { data: { code: 42 } },
    ])
      expect(errorCode(error)).toBeUndefined();
  });
});

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
