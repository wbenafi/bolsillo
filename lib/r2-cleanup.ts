export const R2_DELETION_BATCH_SIZE = 50;
export const R2_DELETION_MAX_RETRY_MS = 6 * 60 * 60 * 1000;

// This preflight runs in a mutation, before paying for a Node action. The Node
// client still validates the endpoint and credentials when it actually runs.
export function missingR2Configuration() {
  const required = ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  if (!process.env.R2_LOCAL_ENDPOINT?.trim()) required.push("R2_ACCOUNT_ID");
  return required.filter((name) => !process.env[name]?.trim());
}

export function deletionRetryDelay(attempts: number) {
  return Math.min(R2_DELETION_MAX_RETRY_MS, 60_000 * 2 ** Math.min(attempts, 9));
}
