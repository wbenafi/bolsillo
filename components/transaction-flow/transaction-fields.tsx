"use client";

import { ArrowDownLeft, ArrowUpRight, Check, ReceiptText } from "lucide-react";
import { useState } from "react";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import { TagSelector } from "@/components/tag-selector";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  ExtractionField,
  ExtractionResult,
} from "@/lib/transaction-extraction";
import type { TransactionErrors } from "@/lib/transaction-flow";
import type { TransactionFormValues } from "@/lib/validators";
import type { Currency, TransactionFile, WalletTag } from "@/types/domain";
import type { TransactionEditorState } from "./types";
import { ReceiptFieldSuggestion } from "./receipt-field-suggestion";

export function TransactionFields({
  walletId,
  currency,
  state,
  tags,
  disabled,
  errors,
  result,
  needsAmountReview,
  draftId,
  source,
  onField,
  onReviewAmount,
  onApply,
  onKeep,
}: {
  walletId: Id<"wallets">;
  currency: Currency;
  state: Pick<TransactionEditorState, "values" | "reviewedFields">;
  tags: WalletTag[];
  disabled: boolean;
  errors: TransactionErrors;
  result?: ExtractionResult;
  needsAmountReview: boolean;
  draftId?: Id<"transactionDrafts">;
  source?: TransactionFile;
  onField: <K extends keyof TransactionFormValues>(
    key: K,
    value: TransactionFormValues[K],
  ) => void;
  onReviewAmount: () => void;
  onApply: (key: ExtractionField) => void;
  onKeep: (key: ExtractionField) => void;
}) {
  const [preview, setPreview] = useState(false);
  const { values } = state;
  const suggestion = (field: ExtractionField) => (
    <ReceiptFieldSuggestion
      field={field}
      result={result}
      values={values}
      reviewed={state.reviewedFields}
      tags={tags}
      disabled={disabled}
      onApply={onApply}
      onKeep={onKeep}
    />
  );
  return (
    <div className="movement-fields">
      <fieldset className="type-picker" disabled={disabled}>
        <legend>Tipo de movimiento</legend>
        <button
          type="button"
          className={`type-option expense${values.type === "expense" ? " active" : ""}`}
          aria-pressed={values.type === "expense"}
          onClick={() => onField("type", "expense")}
        >
          <ArrowUpRight /> Gasto
        </button>
        <button
          type="button"
          className={`type-option income${values.type === "income" ? " active" : ""}`}
          aria-pressed={values.type === "income"}
          onClick={() => onField("type", "income")}
        >
          <ArrowDownLeft /> Ingreso
        </button>
      </fieldset>
      {suggestion("type")}
      <div className="field amount-field">
        <label htmlFor="amount">Monto</label>
        <div className="amount-input">
          <span aria-hidden="true">{currency === "CRC" ? "₡" : "$"}</span>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
            maxLength={30}
            required
            disabled={disabled}
            value={values.amount}
            onChange={(event) => onField("amount", event.target.value)}
            aria-invalid={!!errors.amount}
            aria-describedby={`amount-help${errors.amount ? " amount-error" : ""}${needsAmountReview ? " amount-review-help" : ""}`}
          />
          <span className="movement-currency">{currency}</span>
        </div>
        <p id="amount-help" className="movement-help">
          Hasta dos decimales, sin puntos ni comas de miles.
        </p>
        {errors.amount && (
          <p id="amount-error" className="field-error">
            {errors.amount}
          </p>
        )}
        {suggestion("amount")}
        {needsAmountReview && (
          <div className="movement-amount-review">
            <p id="amount-review-help">
              {result?.currencyMismatch
                ? `El comprobante está en ${result.currency}. Ingresá el monto en ${currency}; no hacemos la conversión.`
                : "Revisá el monto con tu comprobante antes de continuar."}
            </p>
            <div className="movement-inline-actions">
              {source && (
                <button
                  type="button"
                  className="movement-text-button"
                  onClick={() => setPreview(true)}
                >
                  <ReceiptText size={17} /> Ver comprobante
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={disabled}
                onClick={onReviewAmount}
              >
                Confirmar monto revisado
              </button>
            </div>
          </div>
        )}
        {result && !needsAmountReview && (
          <p className="movement-reviewed">
            <Check size={16} /> Monto revisado por vos.
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="description">Descripción</label>
        <input
          id="description"
          name="description"
          required
          maxLength={100}
          disabled={disabled}
          placeholder={
            values.type === "income"
              ? "Ej. Aporte inicial"
              : "Ej. Compra del supermercado"
          }
          value={values.description}
          onChange={(event) => onField("description", event.target.value)}
          aria-invalid={!!errors.description}
          aria-describedby={
            errors.description ? "description-error" : undefined
          }
        />
        {errors.description && (
          <p id="description-error" className="field-error">
            {errors.description}
          </p>
        )}
        {suggestion("description")}
      </div>
      <div className="field">
        <label htmlFor="date">Fecha</label>
        <input
          id="date"
          name="date"
          type="date"
          required
          disabled={disabled}
          value={values.date}
          onChange={(event) => onField("date", event.target.value)}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? "date-error" : undefined}
        />
        {errors.date && (
          <p id="date-error" className="field-error">
            {errors.date}
          </p>
        )}
        {suggestion("date")}
      </div>
      <details
        className="movement-optional"
        open={!!values.notes || values.tagIds.length > 0 || !!errors.notes}
      >
        <summary>
          Notas y etiquetas <span>· Opcional</span>
        </summary>
        <div className="field">
          <label htmlFor="notes">Notas</label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={500}
            disabled={disabled}
            placeholder="Un detalle para recordar"
            value={values.notes}
            onChange={(event) => onField("notes", event.target.value)}
            aria-invalid={!!errors.notes}
            aria-describedby={errors.notes ? "notes-error" : undefined}
          />
          {errors.notes && (
            <p id="notes-error" className="field-error">
              {errors.notes}
            </p>
          )}
          {suggestion("notes")}
        </div>
        <TagSelector
          walletId={walletId}
          tags={tags}
          selectedTagIds={values.tagIds}
          disabled={disabled}
          onChange={(ids) => onField("tagIds", ids)}
        />
        {suggestion("tags")}
      </details>
      {preview && source && (
        <FileViewerDialog
          draftId={draftId}
          file={source}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
