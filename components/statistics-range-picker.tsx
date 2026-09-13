"use client";

import { useState } from "react";
import { lastDaysRange, MAX_STATISTICS_DAYS, rangeDays, rangeError, type DateRange } from "@/lib/statistics";

export function StatisticsRangePicker({ range, today, preset, onChange }: { range: DateRange; today: string; preset?: string | null; onChange: (range: DateRange, preset: string) => void }) {
  const count = rangeDays(range);
  const initialMode = preset && ["7", "30", "90", "month", "days", "custom"].includes(preset) ? preset : range.end === today && [7, 30, 90].includes(count) ? String(count) : "custom";
  const [mode, setMode] = useState(initialMode);
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const [days, setDays] = useState(String(Number.isFinite(count) ? count : 30));
  const [error, setError] = useState<string | null>(null);

  function apply(next: DateRange, nextMode = mode) {
    const message = rangeError(next) ?? (next.end > today ? "Elegí una fecha final hasta hoy." : null);
    setError(message);
    if (!message) onChange(next, nextMode);
  }

  return (
    <form className="statistics-filters" onSubmit={event => {
      event.preventDefault();
      if (mode === "days") {
        const value = Number(days);
        if (!Number.isInteger(value) || value < 1 || value > MAX_STATISTICS_DAYS) {
          setError(`Ingresá entre 1 y ${MAX_STATISTICS_DAYS} días.`);
          return;
        }
        apply(lastDaysRange(today, value));
      } else apply({ start, end });
    }}>
      <div className="statistics-filter-fields">
        <div className="field">
          <label htmlFor="statistics-period">Período</label>
          <select id="statistics-period" value={mode} onChange={event => {
            const next = event.target.value;
            setMode(next);
            setError(null);
            if (["7", "30", "90"].includes(next)) apply(lastDaysRange(today, Number(next)), next);
            if (next === "month") apply({ start: `${today.slice(0, 7)}-01`, end: today }, next);
          }}>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="month">Este mes</option>
            <option value="days">Últimos X días</option>
            <option value="custom">Fechas personalizadas</option>
          </select>
        </div>
        {mode === "days" && <div className="field statistics-days-field"><label htmlFor="statistics-days">Cantidad de días</label><input id="statistics-days" type="number" min="1" max={MAX_STATISTICS_DAYS} required value={days} onChange={event => setDays(event.target.value)} aria-describedby={error ? "statistics-range-error" : undefined} /></div>}
        {mode === "custom" && <>
          <div className="field"><label htmlFor="statistics-start">Desde</label><input id="statistics-start" type="date" max={today} required value={start} onChange={event => setStart(event.target.value)} aria-describedby={error ? "statistics-range-error" : undefined} /></div>
          <div className="field"><label htmlFor="statistics-end">Hasta</label><input id="statistics-end" type="date" max={today} required value={end} onChange={event => setEnd(event.target.value)} aria-describedby={error ? "statistics-range-error" : undefined} /></div>
        </>}
        {(mode === "custom" || mode === "days") && <button className="button primary" type="submit">Aplicar período</button>}
      </div>
      {error && <p className="field-error" role="alert" id="statistics-range-error">{error}</p>}
    </form>
  );
}
