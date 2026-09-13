export async function uploadTransactionFile(url: string, headers: Record<string, string>, file: File) {
  try {
    const response = await fetch(url, {
      method: "PUT", headers, body: file, signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error("Upload rejected");
  } catch {
    throw new Error("No pudimos subir el archivo. Revisá tu conexión y volvé a seleccionarlo para reintentar.");
  }
}
