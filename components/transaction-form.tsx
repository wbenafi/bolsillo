"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { TagSelector } from "@/components/tag-selector";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { moneyInputValue, parseMoneyInput } from "@/lib/money";
import { todayInputValue } from "@/lib/date";
import { transactionSchema, type TransactionFormValues } from "@/lib/validators";
import type { Currency, TransactionType, WalletTag, WalletTransaction } from "@/types/domain";

type TransactionFormProps = {
  walletId: Id<"wallets">;
  currency: Currency;
  initialType?: TransactionType;
  transaction?: WalletTransaction;
  onDeletingChange?: (isDeleting: boolean) => void;
};

export function TransactionForm({ walletId, currency, initialType = "expense", transaction, onDeletingChange }: TransactionFormProps) {
  const router = useRouter();
  const createTransaction = useMutation(api.transactions.createTransaction);
  const updateTransaction = useMutation(api.transactions.updateTransaction);
  const deleteTransaction = useMutation(api.transactions.deleteTransaction);
  const tags = useQuery(api.tags.listTagsByWallet, { walletId }) as WalletTag[] | undefined;
  const [isDeleting, setIsDeleting] = useState(false);
  const { register, handleSubmit, control, setValue, formState: { errors, isSubmitting } } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: transaction?.type ?? initialType,
      amount: transaction ? moneyInputValue(transaction.amountMinor, currency) : "",
      description: transaction?.description ?? "",
      date: transaction?.date ?? todayInputValue(),
      notes: transaction?.notes ?? "",
      tagIds: transaction?.tagIds ?? [],
    },
  });
  const selectedType = useWatch({ control, name: "type" });
  const selectedTagIds = useWatch({ control, name: "tagIds" });

  async function removeTransaction() {
    if (!transaction || !window.confirm("¿Eliminar este movimiento?\nEsta acción cambiará el saldo del bolsillo.")) return;
    setIsDeleting(true);
    onDeletingChange?.(true);
    try {
      await deleteTransaction({ transactionId: transaction._id });
      toast.success("Movimiento eliminado");
      router.replace(`/wallets/${walletId}`);
    } catch (error) {
      toast.error(errorMessage(error));
      onDeletingChange?.(false);
      setIsDeleting(false);
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    const amountMinor = parseMoneyInput(values.amount, currency);
    if (!amountMinor) {
      toast.error(currency === "CRC" ? "Ingresá un monto entero mayor que cero." : "Ingresá un monto válido mayor que cero.");
      return;
    }
    try {
      const payload = {
        type: values.type,
        amountMinor,
        description: values.description.trim(),
        date: values.date,
        notes: values.notes.trim() || undefined,
        tagIds: values.tagIds.length ? values.tagIds : undefined,
      };
      if (transaction) {
        await updateTransaction({ transactionId: transaction._id, ...payload });
        toast.success("Movimiento actualizado");
      } else {
        await createTransaction({ walletId, ...payload });
        toast.success(values.type === "income" ? "Ingreso agregado" : "Gasto agregado");
      }
      router.push(`/wallets/${walletId}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      <fieldset className="type-picker">
        <legend>Tipo de movimiento</legend>
        <button type="button" className={selectedType === "income" ? "type-option income active" : "type-option income"} onClick={() => setValue("type", "income")} aria-pressed={selectedType === "income"}>
          <ArrowDownLeft /> Ingreso
        </button>
        <button type="button" className={selectedType === "expense" ? "type-option expense active" : "type-option expense"} onClick={() => setValue("type", "expense")} aria-pressed={selectedType === "expense"}>
          <ArrowUpRight /> Gasto
        </button>
        <input type="hidden" {...register("type")} />
      </fieldset>
      <div className="field amount-field">
        <label htmlFor="amount">Monto</label>
        <div className="amount-input"><span>{currency === "CRC" ? "₡" : "$"}</span><input id="amount" autoFocus inputMode="decimal" placeholder="0" {...register("amount")} /></div>
        {errors.amount && <p className="field-error">{errors.amount.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="description">Descripción</label>
        <input id="description" maxLength={100} placeholder={selectedType === "income" ? "Ej. Aporte inicial" : "Ej. Compra de materiales"} {...register("description")} />
        {errors.description && <p className="field-error">{errors.description.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="date">Fecha</label>
        <input id="date" type="date" {...register("date")} />
        {errors.date && <p className="field-error">{errors.date.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="notes">Notas <span>Opcional</span></label>
        <textarea id="notes" rows={3} maxLength={500} placeholder="Agregá un detalle que quieras recordar" {...register("notes")} />
      </div>
      <TagSelector
        walletId={walletId}
        tags={tags ?? []}
        selectedTagIds={selectedTagIds}
        onChange={(tagIds) => setValue("tagIds", tagIds, { shouldDirty: true })}
      />
      <div className={transaction ? "form-actions edit-actions" : "form-actions"}>
        {transaction && (
          <button type="button" className="button destructive" onClick={removeTransaction} disabled={isSubmitting || isDeleting}>
            {isDeleting && <LoaderCircle className="spin" size={18} />}
            Eliminar movimiento
          </button>
        )}
        <div className="form-actions-main">
          <button type="button" className="button secondary" onClick={() => router.back()} disabled={isDeleting}>Cancelar</button>
          <button type="submit" className="button primary" disabled={isSubmitting || isDeleting}>
            {isSubmitting && <LoaderCircle className="spin" size={18} />}
            {transaction ? "Guardar cambios" : "Guardar movimiento"}
          </button>
        </div>
      </div>
    </form>
  );
}
