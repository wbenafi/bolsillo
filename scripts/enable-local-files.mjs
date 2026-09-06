import { createClerkClient } from "@clerk/backend";
import { enableLocalIdentity, localEnvironment } from "./local-config.mjs";

try {
  const env = localEnvironment();
  const email = process.argv[2];
  if (!email) throw new Error("Uso: npm run local:enable-files -- tu-correo@example.com");
  if (!env.CLERK_SECRET_KEY) throw new Error("Falta CLERK_SECRET_KEY en .env.local.");
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const { data } = await clerk.users.getUserList({ emailAddress: [email] });
  if (data.length !== 1) throw new Error("No se encontró un único usuario de Clerk con ese correo. Registrate primero en la app.");
  const user = data[0];
  enableLocalIdentity({
    subject: user.id,
    issuer: env.CLERK_JWT_ISSUER_DOMAIN,
    email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || email,
  });
  console.log(`transactions.files habilitado para ${email}. Tu cuenta es superadmin únicamente en Convex local.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
