"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { walletSchema, type WalletFormValues } from "@/lib/validators";
import type { Currency } from "@/types/domain";

type WalletFormProps = {
  walletId?: Id<"wallets">;
  initialValues?: { name: string; description?: string; currency: Currency };
};

export function WalletForm({ walletId, initialValues }: WalletFormProps) {
  const router = useRouter();
  const createWallet = useMutation(api.wallets.createWallet);
  const updateWallet = useMutation(api.wallets.updateWallet);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<WalletFormValues>({
    resolver: zodResolver(walletSchema),
    defaultValues: {
      name: initialValues?.name ?? "",
      description: initialValues?.description ?? "",
      currency: initialValues?.currency ?? "CRC",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description.trim() || undefined,
        currency: values.currency,
      };
      if (walletId) {
        await updateWallet({ walletId, ...payload });
        toast.success("Bolsillo actualizado");
        router.push(`/wallets/${walletId}`);
      } else {
        const newWalletId = await createWallet(payload);
        toast.success("Bolsillo creado");
        router.push(`/wallets/${newWalletId}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="name">Nombre</label>
        <input id="name" autoFocus maxLength={60} placeholder="Ej. Viaje a México" {...register("name")} />
        {errors.name && <p className="field-error">{errors.name.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="description">Descripción <span>Opcional</span></label>
        <textarea id="description" rows={3} maxLength={240} placeholder="¿Para qué querés usar este bolsillo?" {...register("description")} />
        {errors.description && <p className="field-error">{errors.description.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="currency">Moneda</label>
        <select id="currency" {...register("currency")}>
          <option value="CRC">Colón costarricense (CRC)</option>
          <option value="USD">Dólar estadounidense (USD)</option>
        </select>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={() => router.back()}>Cancelar</button>
        <button type="submit" className="button primary" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="spin" size={18} />}
          {walletId ? "Guardar cambios" : "Crear bolsillo"}
        </button>
      </div>
    </form>
  );
}
