import { formatTransactionDate } from "./date";
import { formatMoney, getTransactionSign } from "./money";
import { brandColors } from "./brand";
import type { WalletSummary, WalletTransaction } from "../types/domain";

const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1350;
const MAX_SHARED_TRANSACTIONS = 10;
const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type TextOptions = {
  align?: CanvasTextAlign;
  color?: string;
  maxWidth: number;
  minSize?: number;
  size: number;
  weight?: number;
};

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = color;
  context.fill();
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: TextOptions,
) {
  const { align = "left", color = brandColors.foreground, maxWidth, minSize = 16, weight = 600 } = options;
  let size = options.size;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillStyle = color;
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;

  while (size > minSize && context.measureText(text).width > maxWidth) {
    size -= 2;
    context.font = `${weight} ${size}px ${FONT_FAMILY}`;
  }

  context.fillText(text, x, y, maxWidth);
}

function truncateText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, encoded] = dataUrl.split(",");
  const mimeType = metadata.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function loadBrandIcon() {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No fue posible cargar el ícono de Bolsillo."));
    image.src = "/brand-icon.png";
  });
}

export function walletShareFilename(walletName: string) {
  const slug = walletName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  return `bolsillo-${slug || "resumen"}.png`;
}

export function transactionsForWalletShare(transactions: readonly WalletTransaction[]) {
  return transactions.slice(0, MAX_SHARED_TRANSACTIONS);
}

export async function createWalletShareImage(
  wallet: WalletSummary,
  transactions: readonly WalletTransaction[],
  filterLabels: readonly string[] = [],
) {
  const brandIcon = await loadBrandIcon();
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No fue posible preparar la imagen.");

  context.fillStyle = brandColors.background;
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  context.save();
  context.shadowColor = brandColors.shareShadow;
  context.shadowBlur = 34;
  context.shadowOffsetY = 12;
  fillRoundedRect(context, 48, 48, 984, 1254, 38, brandColors.surface);
  context.restore();

  context.drawImage(brandIcon, 84, 84, 66, 66);
  drawFittedText(context, "Bolsillo", 166, 128, { maxWidth: 300, size: 30, weight: 750 });
  drawFittedText(context, filterLabels.length ? `Filtrado por: ${filterLabels.join(", ")}` : "Resumen para compartir", 992, 124, {
    align: "right",
    color: brandColors.mutedForeground,
    maxWidth: 310,
    size: 18,
    weight: 500,
  });

  context.fillStyle = brandColors.border;
  context.fillRect(88, 176, 904, 2);

  fillRoundedRect(context, 88, 205, 88, 34, 17, brandColors.primarySoft);
  drawFittedText(context, wallet.currency, 132, 228, {
    align: "center",
    color: brandColors.primary,
    maxWidth: 64,
    size: 15,
    weight: 800,
  });
  drawFittedText(context, wallet.name, 88, 290, { maxWidth: 904, minSize: 30, size: 48, weight: 760 });
  if (wallet.description) {
    context.font = `500 19px ${FONT_FAMILY}`;
    context.fillStyle = brandColors.mutedForeground;
    context.textAlign = "left";
    context.fillText(truncateText(context, wallet.description, 904), 88, 324);
  }

  drawFittedText(context, "DISPONIBLE", 88, 365, {
    color: brandColors.mutedForeground,
    maxWidth: 300,
    size: 16,
    weight: 750,
  });
  drawFittedText(context, formatMoney(wallet.balance, wallet.currency), 88, 424, {
    color: wallet.balance < 0 ? brandColors.expense : brandColors.foreground,
    maxWidth: 904,
    minSize: 34,
    size: 58,
    weight: 780,
  });

  fillRoundedRect(context, 88, 462, 440, 104, 22, brandColors.incomeSoft);
  drawFittedText(context, "INGRESOS", 112, 495, { color: brandColors.income, maxWidth: 180, size: 15, weight: 800 });
  drawFittedText(context, formatMoney(wallet.totalIncome, wallet.currency), 112, 540, {
    maxWidth: 392,
    minSize: 20,
    size: 31,
    weight: 730,
  });

  fillRoundedRect(context, 552, 462, 440, 104, 22, brandColors.expenseSoft);
  drawFittedText(context, "GASTOS", 576, 495, { color: brandColors.expense, maxWidth: 180, size: 15, weight: 800 });
  drawFittedText(context, formatMoney(wallet.totalExpense, wallet.currency), 576, 540, {
    maxWidth: 392,
    minSize: 20,
    size: 31,
    weight: 730,
  });

  const sharedTransactions = transactionsForWalletShare(transactions);
  drawFittedText(context, filterLabels.length ? "Movimientos filtrados" : "Últimos movimientos", 88, 625, { maxWidth: 430, size: 29, weight: 760 });
  const movementLabel = transactions.length > MAX_SHARED_TRANSACTIONS
    ? `Últimos ${MAX_SHARED_TRANSACTIONS} de ${transactions.length}`
    : `${transactions.length} ${transactions.length === 1 ? "movimiento" : "movimientos"}`;
  drawFittedText(context, movementLabel, 992, 623, {
    align: "right",
    color: brandColors.mutedForeground,
    maxWidth: 280,
    size: 17,
    weight: 550,
  });

  if (!sharedTransactions.length) {
    fillRoundedRect(context, 88, 662, 904, 118, 20, brandColors.background);
    drawFittedText(context, "Todavía no hay movimientos", 540, 730, {
      align: "center",
      color: brandColors.mutedForeground,
      maxWidth: 700,
      size: 22,
      weight: 600,
    });
  } else {
    sharedTransactions.forEach((transaction, index) => {
      const rowTop = 654 + index * 56;
      const accentColor = transaction.type === "income" ? brandColors.income : brandColors.expense;

      if (index > 0) {
        context.fillStyle = brandColors.separator;
        context.fillRect(88, rowTop, 904, 1);
      }
      context.beginPath();
      context.arc(99, rowTop + 28, 6, 0, Math.PI * 2);
      context.fillStyle = accentColor;
      context.fill();

      context.font = `650 19px ${FONT_FAMILY}`;
      context.textAlign = "left";
      context.fillStyle = brandColors.foreground;
      context.fillText(truncateText(context, transaction.description, 430), 120, rowTop + 25);

      context.font = `500 15px ${FONT_FAMILY}`;
      context.fillStyle = brandColors.mutedForeground;
      context.fillText(formatTransactionDate(transaction.date), 120, rowTop + 46);

      drawFittedText(
        context,
        `${getTransactionSign(transaction.type)}${formatMoney(transaction.amountMinor, wallet.currency)}`,
        992,
        rowTop + 35,
        { align: "right", color: accentColor, maxWidth: 390, minSize: 15, size: 20, weight: 720 },
      );
    });
  }

  context.fillStyle = brandColors.border;
  context.fillRect(88, 1244, 904, 2);
  drawFittedText(context, "Generado desde Bolsillo", 88, 1278, {
    color: brandColors.mutedForeground,
    maxWidth: 360,
    size: 16,
    weight: 550,
  });
  drawFittedText(context, "Los montos reflejan el estado actual del bolsillo", 992, 1278, {
    align: "right",
    color: brandColors.mutedForeground,
    maxWidth: 500,
    size: 16,
    weight: 500,
  });

  return dataUrlToBlob(canvas.toDataURL("image/png"));
}
