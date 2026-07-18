import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

setup.describe.configure({ mode: "serial" });

setup("obtener token de testing de Clerk", async () => {
  await clerkSetup();
});
