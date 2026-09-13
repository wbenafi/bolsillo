"use client";

import { uploadTransactionFile } from "@/lib/upload-transaction-file";

import { createClientId } from "@/lib/client-id";

import type { FunctionReturnType } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowDownLeft, ArrowUpRight, Check, LoaderCircle, PencilLine, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { todayInputValue } from "@/lib/date";
import { errorMessage } from "@/lib/errors";
import { MONEY_VERSION, moneyInputValue, parseMoneyInput } from "@/lib/money";
import { prepareReceiptFile } from "@/lib/prepare-receipt-file";
import { normalizedTransactionFileType } from "@/lib/transaction-files";
import { extractionErrors, extractionFieldNames, type ExtractionField, type ExtractionResult } from "@/lib/transaction-extraction";
import { transactionSchema, type TransactionFormValues } from "@/lib/validators";
import type { TransactionFile, WalletTag } from "@/types/domain";
import { ReceiptDocuments } from "./receipt-documents";
import { TagSelector } from "./tag-selector";
import type { TransactionFormProps } from "./transaction-form";
import { useFeature, useViewer } from "./viewer-context";

type Mode = "manual" | "documents";
type DraftState = { values: TransactionFormValues; mode: Mode; files: TransactionFile[]; selected: Id<"transactionFiles">[]; reviewed: string[] };
const labels: Record<ExtractionField, string> = { type: "Tipo", amount: "Monto", description: "Descripción", date: "Fecha", notes: "Notas", tags: "Tags" };

export function AssistedTransactionForm({ walletId, currency, initialType = "expense", transaction, onDeletingChange, initialDraft }: TransactionFormProps & { initialDraft?: NonNullable<FunctionReturnType<typeof api.transactionDrafts.get>> }) {
  const resumeId = initialDraft?._id;
  const router = useRouter();
  const viewer = useViewer();
  const canAI = useFeature("transactions.aiExtract");
  const canFiles = useFeature("transactions.files");
  const canRead = canAI && canFiles;
  const create = useMutation(api.transactionDrafts.create);
  const update = useMutation(api.transactionDrafts.update);
  const save = useMutation(api.transactionDrafts.save);
  const discard = useMutation(api.transactionDrafts.discard);
  const beginFiles = useMutation(api.transactionDrafts.beginFiles);
  const sign = useAction(api.r2.createUploadUrls);
  const verify = useAction(api.transactionAI.verifyUpload);
  const abort = useMutation(api.transactionFiles.abortUpload);
  const startAnalysis = useMutation(api.transactionExtractions.start);
  const cancelAnalysis = useMutation(api.transactionExtractions.cancel);
  const setPreference = useMutation(api.transactionDrafts.setPreferredMode);
  const deleteTransaction = useMutation(api.transactions.deleteTransaction);
  const createManual = useMutation(api.transactions.createTransaction);
  const updateManual = useMutation(api.transactions.updateTransaction);
  const tags = useQuery(api.tags.listTagsByWallet, { walletId }) as WalletTag[] | undefined;
  const usage = useQuery(api.transactionExtractions.usage, {});
  const [draftId, setDraftId] = useState(resumeId);
  const remote = useQuery(api.transactionDrafts.get, draftId ? { draftId } : "skip");
  const [state, setState] = useState<DraftState>(() => ({
    values: initialDraft?.values ?? { type: transaction?.type ?? initialType, amount: transaction ? moneyInputValue(transaction.amountMinor, currency) : "", description: transaction?.description ?? "", date: transaction?.date ?? todayInputValue(), notes: transaction?.notes ?? "", tagIds: transaction?.tagIds ?? [] },
    mode: !canRead ? "manual" : initialDraft?.mode ?? (transaction ? "manual" : viewer.user.newTransactionMode ?? "manual"),
    files: initialDraft?.files ?? transaction?.files ?? [], selected: initialDraft?.selectedFileIds ?? (transaction?.files ?? []).map(f => f._id), reviewed: initialDraft?.reviewedFields ?? [],
  }));
  const current = useRef(state);
  const idRef = useRef(resumeId);
  const version = useRef(initialDraft?.version ?? 0);
  const createPromise = useRef<Promise<Id<"transactionDrafts">> | null>(null);
  const clientKey = useRef<string | null>(null);
  const isHydrated = true;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string>();
  const [dirty, setDirty] = useState(0);
  const sequence = useRef(0);
  const persisted = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const applied = useRef(new Set<string>());
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const analysisRequest = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const formSection = useRef<HTMLDivElement>(null);
  const job = remote?.extraction;
  const analyzing = job?.status === "queued" || job?.status === "processing" || starting;
  const result = job?.status === "ready" ? job.result as ExtractionResult : undefined;
  const usable = result && ["ok", "partial"].includes(result.status) ? result : undefined;
  const busy = uploading || submitting || deleting || !isHydrated;
  const limitReached = !!usage && usage.used + usage.reserved >= usage.limit;

  const change = useCallback((next: DraftState | ((value: DraftState) => DraftState)) => {
    const value = typeof next === "function" ? next(current.current) : next;
    current.current = value; setState(value);
    sequence.current += 1; setDirty(sequence.current);
  }, []);

  const ensureDraft = useCallback(async () => {
    if (idRef.current) return idRef.current;
    if (!createPromise.current) {
      clientKey.current ??= createClientId();
      createPromise.current = create({ walletId, transactionId: transaction?._id, expectedRevision: transaction?.revision ?? 0, expectedFileRevision: transaction?.fileRevision ?? 0, clientKey: clientKey.current, values: current.current.values, mode: current.current.mode }).then(id => {
        idRef.current = id; setDraftId(id);
        const url = new URL(window.location.href); url.searchParams.set("draft", id); window.history.replaceState(null, "", url);
        return id;
      }).catch(error => { createPromise.current = null; throw error; });
    }
    return createPromise.current;
  }, [create, walletId, transaction?._id, transaction?.revision, transaction?.fileRevision]);

  const flush = useCallback(async () => {
    const work = queue.current.catch(() => undefined).then(async () => {
      if (persisted.current === sequence.current && idRef.current) return;
      setSaveState("saving");
      const id = await ensureDraft();
      const snapshot = current.current;
      const seq = sequence.current;
      version.current = await update({ draftId: id, version: version.current, values: snapshot.values, mode: snapshot.mode, fileIds: snapshot.files.map(f => f._id), selectedFileIds: snapshot.selected, reviewedFields: snapshot.reviewed });
      persisted.current = seq;
      setSaveState("saved");
    });
    queue.current = work;
    try { await work; } catch (error) { setSaveState("error"); setMessage(errorMessage(error)); throw error; }
  }, [ensureDraft, update]);

  useEffect(() => {
    if (!dirty || !isHydrated || uploading || submitting || (!canRead && !draftId)) return;
    const timer = setTimeout(() => { void flush().catch(() => undefined); }, 650);
    return () => clearTimeout(timer);
  }, [dirty, isHydrated, uploading, submitting, canRead, draftId, flush]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) { if (uploading || persisted.current !== sequence.current) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  useEffect(() => {
    if (busy || !usable || !job || !isHydrated || !tags || state.mode !== "documents" || applied.current.has(job._id)) return;
    applied.current.add(job._id);
    change(previous => {
      const values = { ...previous.values };
      for (const key of extractionFieldNames) {
        const field = usable.fields[key];
        if (previous.reviewed.includes(key) || field.value === null || !["high", "medium"].includes(field.confidence) || (key === "amount" && usable.currencyMismatch)) continue;
        if (key === "tags") {
          if (!values.tagIds.length) values.tagIds = tags.filter(t => (field.value as string[]).some(label => label.toLocaleLowerCase() === t.label.toLocaleLowerCase())).map(t => t._id);
        } else if (!values[key]) {
          if (key === "type") values.type = field.value as "income" | "expense";
          else values[key] = field.value as string;
        }
      }
      return { ...previous, values };
    });
    setReviewOpen(true);
  }, [usable, job, isHydrated, tags, state.mode, change, busy]);

  function setField<K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) {
    const field = key === "tagIds" ? "tags" : key;
    change(previous => ({ ...previous, values: { ...previous.values, [key]: value }, reviewed: analyzing || usable ? [...new Set([...previous.reviewed, field])] : previous.reviewed }));
    setErrors(previous => ({ ...previous, [key]: "" }));
  }
  async function switchMode(mode: Mode) {
    if (mode === "documents" && !canRead) return;
    if (mode === "manual" && analyzing && idRef.current) {
      if (job) applied.current.add(job._id);
      void cancelAnalysis({ draftId: idRef.current }).catch(error => setMessage(errorMessage(error)));
    }
    change(previous => ({ ...previous, mode }));
    if (!transaction) void setPreference({ mode }).catch(() => toast.error("No pudimos recordar esta preferencia. Intentá de nuevo."));
  }
  async function addFiles(incoming: File[]) {
    if (current.current.files.length + incoming.length > 5) { toast.error("Podés agregar hasta 5 archivos del mismo comprobante."); return; }
    setUploading(true); setMessage(undefined);
    let batchId: Id<"fileUploadBatches"> | undefined;
    let attachedLocally = false;
    try {
      const prepared: File[] = [];
      for (const file of incoming) prepared.push(await prepareReceiptFile(file));
      await flush();
      const id = await ensureDraft();
      const batch = await beginFiles({ draftId: id, files: prepared.map(file => ({ originalName: file.name, mimeType: normalizedTransactionFileType(file)!, sizeBytes: file.size })) });
      batchId = batch.batchId;
      const signed = await sign({ batchId });
      const results = await Promise.allSettled(batch.fileIds.map(async (fileId, index) => {
        const upload = signed.uploads.find(u => u.fileId === fileId);
        if (!upload) throw new Error("No pudimos preparar el archivo.");
        await uploadTransactionFile(upload.url, upload.headers, prepared[index]);
      }));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
      await verify({ draftId: id, batchId });
      const files: TransactionFile[] = prepared.map((f, index) => ({ _id: batch.fileIds[index], originalName: f.name, mimeType: normalizedTransactionFileType(f)!, sizeBytes: f.size, order: current.current.files.length + index, createdAt: Date.now(), updatedAt: Date.now() }));
      attachedLocally = true;
      change(previous => ({ ...previous, files: [...previous.files, ...files], selected: [...previous.selected, ...batch.fileIds], reviewed: [] }));
      await flush();
      batchId = undefined;
    } catch (error) {
      // On a failed draft update, preserve the verified upload for recovery/TTL;
      // do not delete files that a successful-but-disconnected update attached.
      if (batchId && !attachedLocally) { try { await abort({ batchId }); } catch { /* Expiry cleanup retries. */ } }
      setMessage(errorMessage(error));
    } finally { setUploading(false); }
  }
  async function analyze(reanalyze = false) {
    if (!canRead || busy || analyzing || analysisRequest.current) return;
    analysisRequest.current = true;
    setStarting(true); setMessage(undefined);
    change(previous => ({ ...previous, reviewed: [] }));
    try { await flush(); await startAnalysis({ draftId: await ensureDraft(), version: version.current, reanalyze, requestKey: createClientId() }); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { analysisRequest.current = false; setStarting(false); }
  }
  function applyField(key: ExtractionField) {
    if (!usable) return;
    const value = usable.fields[key].value;
    if (value === null || (key === "amount" && usable.currencyMismatch)) return;
    if (key === "tags") setField("tagIds", (tags ?? []).filter(t => (value as string[]).some(label => label.toLocaleLowerCase() === t.label.toLocaleLowerCase())).map(t => t._id));
    else if (key === "type") setField(key, value as "income" | "expense");
    else setField(key, value as string);
  }
  function hint(key: ExtractionField) {
    if (!usable || state.reviewed.includes(key)) return null;
    const f = usable.fields[key];
    if (f.value === null) return <p className="receipt-field-hint">Completá este dato si corresponde.</p>;
    if (f.confidence === "medium") return <p className="receipt-field-hint">Revisá este dato con el comprobante.</p>;
    return null;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = transactionSchema.safeParse(current.current.values);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map(i => [i.path[0], i.message]))); setReviewOpen(true); setTimeout(() => formSection.current?.querySelector<HTMLInputElement>("input:invalid")?.focus(), 0); return; }
    const amountMinor = parseMoneyInput(parsed.data.amount, currency);
    if (!amountMinor) { setErrors({ amount: "Ingresá un monto mayor que cero con hasta dos decimales, sin puntos ni comas de miles." }); setReviewOpen(true); return; }
    setSubmitting(true); setMessage(undefined);
    try {
      const payload = { type: parsed.data.type, description: parsed.data.description, date: parsed.data.date, notes: parsed.data.notes, tagIds: parsed.data.tagIds, amountMinor, moneyVersion: MONEY_VERSION };
      if (idRef.current || canRead) { await flush(); await save({ draftId: await ensureDraft(), version: version.current, ...payload }); }
      else if (transaction) await updateManual({ transactionId: transaction._id, ...payload });
      else await createManual({ walletId, ...payload });
      persisted.current = sequence.current;
      toast.success(transaction ? "Movimiento actualizado" : "Movimiento agregado"); router.push(`/wallets/${walletId}`);
    } catch (error) { setMessage(errorMessage(error)); setSubmitting(false); }
  }
  async function leave() {
    setSubmitting(true);
    try { if (sequence.current || idRef.current) await flush(); router.push(`/wallets/${walletId}`); }
    catch { setSubmitting(false); /* Keep the form and explain the failed save. */ }
  }
  async function discardDraft() {
    if (!window.confirm("¿Descartar este borrador y sus archivos nuevos?")) return;
    setSubmitting(true);
    try { await queue.current.catch(() => undefined); if (idRef.current) await discard({ draftId: idRef.current }); persisted.current = sequence.current; router.push(`/wallets/${walletId}`); }
    catch (error) { setMessage(errorMessage(error)); setSubmitting(false); }
  }
  async function removeTransaction() {
    if (!transaction || !window.confirm("¿Eliminar este movimiento y sus archivos? Esta acción cambiará el saldo del bolsillo.")) return;
    setDeleting(true); onDeletingChange?.(true);
    try { await queue.current.catch(() => undefined); if (idRef.current) await discard({ draftId: idRef.current }); await deleteTransaction({ transactionId: transaction._id }); persisted.current = sequence.current; toast.success("Movimiento eliminado"); router.replace(`/wallets/${walletId}`); }
    catch (error) { setMessage(errorMessage(error)); setDeleting(false); onDeletingChange?.(false); }
  }

  const documentsMode = state.mode === "documents" && canRead;
  const showFields = !documentsMode || reviewOpen || !!usable;
  const hasResult = !!result && !analyzing;
  return <form className="form-card assisted-form" onSubmit={submit} noValidate aria-busy={submitting}>
    <div className="receipt-tabs" role="tablist" aria-label="Cómo agregar el movimiento">
      {(["manual", "documents"] as const).map((mode, index) => <button key={mode} id={`mode-${mode}`} type="button" role="tab" aria-selected={documentsMode === (mode === "documents")} aria-controls="movement-panel" tabIndex={documentsMode === (mode === "documents") ? 0 : -1} disabled={busy || (mode === "documents" && !canRead)} onClick={() => void switchMode(mode)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "manual" : event.key === "End" ? "documents" : index === 0 ? "documents" : "manual"; void switchMode(next); document.getElementById(`mode-${next}`)?.focus(); } }}>{mode === "manual" ? <PencilLine size={18} /> : <ReceiptText size={18} />}{mode === "manual" ? "Manual" : "Comprobantes"}</button>)}
    </div>
    <div id="movement-panel" role="tabpanel" aria-labelledby={documentsMode ? "mode-documents" : "mode-manual"}>
      {!canRead && <p className="receipt-notice">La lectura de comprobantes no está disponible. Podés completar y guardar tus datos manualmente.</p>}
      {documentsMode && <>
        <ReceiptDocuments draftId={draftId} files={state.files} selected={state.selected} disabled={busy || analyzing} uploading={uploading} onAdd={files => void addFiles(files)} onRemove={id => change(previous => ({ ...previous, files: previous.files.filter(f => f._id !== id), selected: previous.selected.filter(f => f !== id), reviewed: [] }))} onSelect={selected => change(previous => ({ ...previous, selected, reviewed: [] }))} />
        <div className="receipt-analyze">
          <button type="button" className="button primary" onClick={() => void analyze()} disabled={busy || analyzing || !state.selected.length || limitReached || hasResult}>{analyzing ? <LoaderCircle size={18} className="spin" /> : hasResult ? <Check size={18} /> : <ReceiptText size={18} />}{analyzing ? "Leyendo tu comprobante…" : hasResult ? "Comprobante leído" : "Completar con este comprobante"}</button>
          {hasResult && <button type="button" className="receipt-text-button" disabled={busy || analyzing || limitReached} onClick={() => void analyze(true)}>Volver a leer · usa otra lectura</button>}
          <p className="receipt-help" role="status">{analyzing ? "Analizando tus archivos con IA. Podés seguir manualmente." : "Usamos IA para leer tus archivos. Vos revisás antes de guardar."}</p>
          {limitReached && !analyzing && <p className="receipt-notice">Usaste las {usage?.limit} lecturas de este mes. Podés seguir manualmente.</p>}
          {job?.status === "failed" && <p className="receipt-notice" role="alert">{extractionErrors[job.errorCode ?? "unavailable"] ?? extractionErrors.unavailable}</p>}
          {result && !usable && <p className="receipt-notice" role="alert">{extractionErrors[result.status] ?? extractionErrors.unreadable}</p>}
          {!showFields && <button className="receipt-text-button" type="button" onClick={() => { setReviewOpen(true); setTimeout(() => formSection.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}>Completar los datos por mi cuenta</button>}
        </div>
      </>}
      {!!message && <div className="receipt-notice error" role="alert">{message}{saveState === "error" && <button type="button" className="receipt-text-button" onClick={() => void flush().then(() => setMessage(undefined)).catch(() => undefined)}>Volver a guardar el borrador</button>}</div>}
      {showFields && <div ref={formSection} className="receipt-movement-fields">
        {usable && <div className="receipt-review-heading"><span className="receipt-success-icon"><Check size={19} /></span><div><h2>Revisá los datos</h2><p>Completamos lo que pudimos leer. Podés cambiarlo.</p></div></div>}
        {usable?.currencyMismatch && <p className="receipt-notice">El comprobante está en {usable.currency} y este bolsillo usa {currency}. Ingresá el monto en {currency}; no hacemos la conversión.</p>}
        {usable?.duplicate && <p className="receipt-notice">Hay un movimiento con monto y fecha similares. Revisá si ya lo guardaste.</p>}
        {usable && <ReceiptSuggestions sourceNames={(job?.fileIds ?? []).map(id => state.files.find(file => file._id === id)?.originalName ?? "Archivo")} disabled={busy} result={usable} values={state.values} reviewed={state.reviewed} tags={tags ?? []} onApply={applyField} onKeep={key => change(previous => ({ ...previous, reviewed: [...new Set([...previous.reviewed, key])] }))} />}
        <fieldset className="type-picker" disabled={busy}><legend>Tipo de movimiento</legend><button type="button" className={`type-option income${state.values.type === "income" ? " active" : ""}`} aria-pressed={state.values.type === "income"} onClick={() => setField("type", "income")}><ArrowDownLeft /> Ingreso</button><button type="button" className={`type-option expense${state.values.type === "expense" ? " active" : ""}`} aria-pressed={state.values.type === "expense"} onClick={() => setField("type", "expense")}><ArrowUpRight /> Gasto</button></fieldset>
        {hint("type")}
        <div className="field amount-field"><label htmlFor="amount">Monto <span>{currency}</span></label><div className="amount-input"><span>{currency === "CRC" ? "₡" : "$"}</span><input id="amount" inputMode="decimal" placeholder="0,00" required disabled={busy} value={state.values.amount} onChange={e => setField("amount", e.target.value)} aria-invalid={!!errors.amount} aria-describedby={errors.amount ? "amount-error" : undefined} /></div>{errors.amount && <p id="amount-error" className="field-error">{errors.amount}</p>}{hint("amount")}</div>
        <div className="field"><label htmlFor="description">Descripción</label><input id="description" required maxLength={100} disabled={busy} placeholder="Ej. Compra del supermercado" value={state.values.description} onChange={e => setField("description", e.target.value)} aria-invalid={!!errors.description} />{errors.description && <p className="field-error">{errors.description}</p>}{hint("description")}</div>
        <div className="field"><label htmlFor="date">Fecha</label><input id="date" type="date" required disabled={busy} value={state.values.date} onChange={e => setField("date", e.target.value)} aria-invalid={!!errors.date} />{errors.date && <p className="field-error">{errors.date}</p>}{hint("date")}</div>
        <div className="field"><label htmlFor="notes">Notas <span>Opcional</span></label><textarea id="notes" rows={3} maxLength={500} disabled={busy} placeholder="Un detalle que quieras recordar" value={state.values.notes} onChange={e => setField("notes", e.target.value)} />{hint("notes")}</div>
        <TagSelector walletId={walletId} tags={tags ?? []} selectedTagIds={state.values.tagIds} onChange={ids => { if (!busy) setField("tagIds", ids); }} />
        {!documentsMode && (!!state.files.length || canRead) && <p className="receipt-help">{!!state.files.length && <><PaperclipLabel /> {state.files.length} {state.files.length === 1 ? "archivo adjunto" : "archivos adjuntos"}. Se conservarán al guardar. </>}{canRead && <button type="button" className="receipt-text-button" onClick={() => void switchMode("documents")}>{state.files.length ? "Ver comprobantes" : "Adjuntar un comprobante"}</button>}</p>}
      </div>}
    </div>
    <div className="receipt-bottom">
      {draftId && <p className="receipt-draft-status" role="status">{saveState === "saving" ? "Guardando borrador…" : saveState === "error" ? "El borrador tiene cambios sin guardar" : `Borrador guardado${remote?.expiresAt ? ` hasta ${new Date(remote.expiresAt).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : " por 24 horas"}`}</p>}
      <div className="form-actions-main"><button type="button" className="button secondary" disabled={busy} onClick={() => void leave()}>{draftId ? "Continuar después" : "Cancelar"}</button>{showFields && <button type="submit" className="button primary" disabled={busy}>{submitting && <LoaderCircle className="spin" size={18} />}{transaction ? "Guardar cambios" : "Guardar movimiento"}</button>}</div>
      <p className="receipt-help">El saldo cambia solo al guardar el movimiento.</p>
      {(draftId || transaction) && <div className="receipt-secondary-actions">{draftId && <button type="button" className="receipt-text-button" disabled={busy} onClick={() => void discardDraft()}>Descartar borrador</button>}{transaction && <button type="button" className="receipt-text-button destructive" disabled={busy} onClick={() => void removeTransaction()}>Eliminar movimiento</button>}</div>}
    </div>
  </form>;
}
function PaperclipLabel() { return <ReceiptText size={15} aria-hidden="true" />; }
function ReceiptSuggestions({ sourceNames, disabled, result, values, reviewed, tags, onApply, onKeep }: { sourceNames: string[]; disabled: boolean; result: ExtractionResult; values: TransactionFormValues; reviewed: string[]; tags: WalletTag[]; onApply: (key: ExtractionField) => void; onKeep: (key: ExtractionField) => void }) {
  const suggestions = extractionFieldNames.filter(key => {
    const field = result.fields[key];
    if (reviewed.includes(key) || field.value === null || (key === "amount" && result.currencyMismatch)) return false;
    const current = key === "tags" ? tags.filter(t => values.tagIds.includes(t._id)).map(t => t.label) : values[key];
    return field.confidence === "low" || JSON.stringify(current) !== JSON.stringify(field.value);
  });
  if (!suggestions.length) return null;
  return <div className="receipt-suggestions"><p>Estos datos necesitan tu decisión</p>{suggestions.map(key => {
    const field = result.fields[key];
    const value = key === "type" ? field.value === "income" ? "Ingreso" : "Gasto" : Array.isArray(field.value) ? field.value.join(", ") : field.value;
    return <div className="receipt-suggestion" key={key}><div><span>{labels[key]} <small>{field.confidence === "low" ? "No se lee con claridad" : "Valor encontrado"}</small></span><strong>{value || "Sin tags"}</strong><details><summary>Ver el detalle</summary><p>{field.reason}</p>{field.evidence && <p>{sourceNames[field.evidence.file - 1] ?? `Archivo ${field.evidence.file}`}, página {field.evidence.page}: “{field.evidence.quote}”</p>}</details></div><div className="receipt-suggestion-actions"><button type="button" className="button secondary" disabled={disabled} onClick={() => onApply(key)}>Usar este dato</button><button type="button" className="receipt-text-button" disabled={disabled} onClick={() => onKeep(key)}>Dejar como está</button></div></div>;
  })}</div>;
}
