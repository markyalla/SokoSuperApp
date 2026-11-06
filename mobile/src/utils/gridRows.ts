// Turns a flat FlatList data array into rows of `columns` items so a long list
// can render as a compact grid while short lists keep their large cards.
// Section-header entries (`__sectionHeader: true`) stay as their own full-width
// row and start a fresh grid row, so "Near You" / "Other Regions" still work.

/** Above this many cards, lists switch to the compact 3-across grid. */
export const GRID_THRESHOLD = 6;
export const GRID_COLUMNS = 3;

export type GridRow<T> = { __gridRow: true; id: string; items: T[] };

export function toGridRows<T extends { id?: any; __sectionHeader?: boolean }>(
  data: T[],
  columns: number = GRID_COLUMNS,
): (T | GridRow<T>)[] {
  const out: (T | GridRow<T>)[] = [];
  let row: T[] = [];
  const flush = () => {
    if (row.length === 0) return;
    out.push({ __gridRow: true, id: `__row_${String(row[0].id)}`, items: row });
    row = [];
  };
  for (const item of data) {
    if (item.__sectionHeader) {
      flush();
      out.push(item);
      continue;
    }
    row.push(item);
    if (row.length === columns) flush();
  }
  flush();
  return out;
}

export function isGridRow<T>(item: any): item is GridRow<T> {
  return !!item && item.__gridRow === true;
}
