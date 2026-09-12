export const MAX_TRANSACTION_FILES = 5;
export const MAX_TRANSACTION_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TRANSACTION_FILE_NAME_LENGTH = 180;
export const MAX_TRANSACTION_FILE_DISPLAY_NAME_LENGTH = 100;

export const TRANSACTION_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;

export type TransactionFileType = (typeof TRANSACTION_FILE_TYPES)[number];

export const TRANSACTION_FILE_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
  ".txt",
].join(",");

const TYPE_BY_EXTENSION: Record<string, TransactionFileType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
};

export function isTransactionFileType(value: string): value is TransactionFileType {
  return TRANSACTION_FILE_TYPES.includes(value as TransactionFileType);
}

export function transactionFileTypeForName(name: string) {
  const extension = name.split(".").pop()?.toLocaleLowerCase("en");
  return extension ? TYPE_BY_EXTENSION[extension] : undefined;
}

export function normalizedTransactionFileType(file: Pick<File, "name" | "type">) {
  const extensionType = transactionFileTypeForName(file.name);
  if (!extensionType) return undefined;
  if (!file.type) return extensionType;
  return isTransactionFileType(file.type) && file.type === extensionType
    ? file.type
    : undefined;
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024 / 1024).toLocaleString("es-CR", {
    maximumFractionDigits: 1,
  })} MB`;
}

export function transactionFileKind(mimeType: TransactionFileType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "text";
}
