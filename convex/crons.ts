import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "Reconciliar limpieza de archivos R2",
  internal.transactionFiles.reconcileStorageCleanup,
);

export default crons;
