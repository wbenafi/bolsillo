import { afterEach, expect, it, vi } from "vitest";

import { createClientId } from "./client-id";

afterEach(() => vi.unstubAllGlobals());

it("creates distinct UUIDs when HTTP LAN access does not expose randomUUID", () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues });

  const ids = Array.from({ length: 100 }, createClientId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
