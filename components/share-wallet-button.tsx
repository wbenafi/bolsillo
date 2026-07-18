"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  createWalletShareImage,
  walletShareFilename,
} from "@/lib/wallet-share-image";
import type { WalletSummary, WalletTransaction } from "@/types/domain";

type ShareWalletButtonProps = {
  transactions: WalletTransaction[];
  wallet: WalletSummary;
};

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.download = file.name;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ShareWalletButton({ transactions, wallet }: ShareWalletButtonProps) {
  const [isSharing, setIsSharing] = useState(false);

  async function shareWallet(event: React.MouseEvent<HTMLButtonElement>) {
    if (isSharing) return;
    setIsSharing(true);
    event.currentTarget.closest("details")?.removeAttribute("open");

    try {
      const blob = createWalletShareImage(wallet, transactions);
      const file = new File([blob], walletShareFilename(wallet.name), { type: "image/png" });
      const canShareFile = typeof navigator.share === "function"
        && typeof navigator.canShare === "function"
        && navigator.canShare({ files: [file] });

      if (canShareFile) {
        await navigator.share({
          files: [file],
          text: `Resumen de ${wallet.name}`,
          title: `Bolsillo · ${wallet.name}`,
        });
        toast.success("Resumen compartido");
      } else {
        downloadFile(file);
        toast.success("Imagen descargada");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("No se pudo preparar la imagen. Intentá de nuevo.");
      }
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <button type="button" onClick={shareWallet} disabled={isSharing}>
      <Share2 aria-hidden="true" />
      {isSharing ? "Preparando…" : "Compartir resumen"}
    </button>
  );
}
