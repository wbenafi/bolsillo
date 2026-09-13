import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "Reconciliar limpieza de archivos R2",
  internal.transactionFiles.reconcileStorageCleanup,
);

crons.hourly("Limpiar borradores y registros de IA", internal.transactionDrafts.cleanup);

export default crons;
