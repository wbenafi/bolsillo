export function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message;
  }

  if (error instanceof Error) {
    const marker = error.message.lastIndexOf("Uncaught ConvexError: ");
    const message = marker >= 0 ? error.message.slice(marker + 22) : error.message;

    try {
      const data = JSON.parse(message) as unknown;
      if (
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        return data.message;
      }
    } catch {
      // Plain Error messages are already safe to show.
    }

    return message;
  }
  return "Algo salió mal. Intentá de nuevo.";
}
