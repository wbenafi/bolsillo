export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const marker = error.message.lastIndexOf("Uncaught ConvexError: ");
    return marker >= 0 ? error.message.slice(marker + 22) : error.message;
  }
  return "Algo salió mal. Intentá de nuevo.";
}
