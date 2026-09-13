/** Calendar-only arithmetic: transaction dates do not represent instants in time. */
const DAY_MS = 86_400_000;
export const MAX_STATISTICS_DAYS = 3660;
export type DateRange = { start: string; end: string };
export type StatisticsGroup = "day" | "week" | "month";
export type StatisticsMovement = {
  type: "income" | "expense";
  amountMinor: number;
  date: string;
  tagIds?: readonly string[];
};

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftDate(value: string, days: number) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function rangeDays(range: DateRange) {
  return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / DAY_MS) + 1;
}

export function rangeError(range: DateRange): string | null {
  if (!isCalendarDate(range.start) || !isCalendarDate(range.end)) return "Ingresá dos fechas válidas.";
  if (range.start > range.end) return "La fecha inicial debe ser anterior o igual a la final.";
  if (rangeDays(range) > MAX_STATISTICS_DAYS) return `Elegí un período de hasta ${MAX_STATISTICS_DAYS} días.`;
  if (!isCalendarDate(shiftDate(range.start, -rangeDays(range)))) return "Elegí una fecha inicial más reciente.";
  return null;
}

export function lastDaysRange(today: string, days: number): DateRange {
  return { start: shiftDate(today, 1 - days), end: today };
}

export function previousRange(range: DateRange): DateRange {
  return { start: shiftDate(range.start, -rangeDays(range)), end: shiftDate(range.start, -1) };
}

export function defaultGroup(range: DateRange): StatisticsGroup {
  const days = rangeDays(range);
  return days <= 14 ? "day" : days <= 180 ? "week" : "month";
}

export function periodTotals(transactions: readonly StatisticsMovement[], days: number) {
  let income = 0;
  let expense = 0;
  for (const transaction of transactions) {
    if (transaction.type === "income") income += transaction.amountMinor;
    else expense += transaction.amountMinor;
  }
  return { income, expense, net: income - expense, dailyExpense: expense / days, count: transactions.length };
}

export function amountChange(current: number, previous: number) {
  return { amount: current - previous, percent: previous === 0 ? null : ((current - previous) / previous) * 100 };
}

export function buildTrend(transactions: readonly StatisticsMovement[], range: DateRange, group: StatisticsGroup) {
  const buckets: Array<DateRange & { income: number; expense: number; count: number }> = [];
  let start = range.start;
  while (start <= range.end) {
    let end = start;
    if (group === "week") {
      const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
      end = shiftDate(start, (7 - weekday) % 7);
    } else if (group === "month") {
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + 1, 0);
      end = date.toISOString().slice(0, 10);
    }
    end = end > range.end ? range.end : end;
    buckets.push({ start, end, income: 0, expense: 0, count: 0 });
    if (end === range.end) break;
    start = shiftDate(end, 1);
  }
  const ordered = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  let index = 0;
  for (const transaction of ordered) {
    if (transaction.date < range.start || transaction.date > range.end) continue;
    while (buckets[index].end < transaction.date) index++;
    buckets[index][transaction.type] += transaction.amountMinor;
    buckets[index].count++;
  }
  return buckets;
}

export function tagBreakdown(transactions: readonly StatisticsMovement[], knownTagIds: readonly string[], type: StatisticsMovement["type"]) {
  const known = new Set(knownTagIds);
  const totals = new Map<string | null, { tagId: string | null; amount: number; count: number }>();
  let overlapping = false;
  for (const transaction of transactions) {
    if (transaction.type !== type) continue;
    const tagIds = [...new Set(transaction.tagIds ?? [])].filter(id => known.has(id));
    if (tagIds.length > 1) overlapping = true;
    for (const tagId of tagIds.length ? tagIds : [null]) {
      const entry = totals.get(tagId) ?? { tagId, amount: 0, count: 0 };
      entry.amount += transaction.amountMinor;
      entry.count++;
      totals.set(tagId, entry);
    }
  }
  return { overlapping, rows: [...totals.values()].sort((a, b) => b.amount - a.amount || (a.tagId ?? "").localeCompare(b.tagId ?? "")) };
}

const shortDate = new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export function statisticsDate(value: string, year = false) {
  return (year ? fullDate : shortDate).format(new Date(`${value}T00:00:00Z`));
}
export function statisticsRangeLabel(range: DateRange) {
  return range.start === range.end ? statisticsDate(range.start, true) : `${statisticsDate(range.start, true)} – ${statisticsDate(range.end, true)}`;
}
