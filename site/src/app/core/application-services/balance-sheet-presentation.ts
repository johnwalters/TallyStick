import { ACCOUNT_TYPE_CATALOG } from '../domain-model/account-taxonomy';
import { BalanceSheetRow, accountTypeBalanceSheetRowId, balanceSheetDetailKey } from '../domain-model/balance-sheet.types';

export interface PresentableBalanceSheetRow {
  readonly row: BalanceSheetRow;
  readonly parentAccountId?: string;
  readonly displayOrder: number;
}

export interface BalanceSheetHierarchyResult {
  readonly rows: readonly BalanceSheetRow[];
  readonly invalidAccountIds: readonly string[];
}

export function presentBalanceSheetRows(input: readonly PresentableBalanceSheetRow[], asOfDate: string, includeZero: boolean): BalanceSheetHierarchyResult {
  const typeOrder = new Map(ACCOUNT_TYPE_CATALOG.map((type, index) => [type.accountType, index]));
  const byIdentity = new Map(input.map(item => [`${item.row.accountRole}:${item.row.accountId}`, item]));
  const invalid = new Set<string>();
  for (const item of input) {
    if (!item.parentAccountId) continue;
    const key = `${item.row.accountRole}:${item.parentAccountId}`;
    if (!byIdentity.has(key)) invalid.add(item.row.accountId!);
    const seen = new Set([item.row.accountId]);
    let cursor = byIdentity.get(key);
    while (cursor) {
      if (seen.has(cursor.row.accountId)) { invalid.add(item.row.accountId!); break; }
      seen.add(cursor.row.accountId);
      cursor = cursor.parentAccountId ? byIdentity.get(`${cursor.row.accountRole}:${cursor.parentAccountId}`) : undefined;
    }
  }
  const compare = (a: PresentableBalanceSheetRow, b: PresentableBalanceSheetRow) =>
    (typeOrder.get(a.row.accountType!) ?? 999) - (typeOrder.get(b.row.accountType!) ?? 999)
    || a.displayOrder - b.displayOrder || a.row.label.localeCompare(b.row.label) || a.row.accountId!.localeCompare(b.row.accountId!);
  const children = new Map<string, PresentableBalanceSheetRow[]>();
  const roots: PresentableBalanceSheetRow[] = [];
  for (const item of input) {
    if (invalid.has(item.row.accountId!)) continue;
    if (item.parentAccountId) {
      const key = `${item.row.accountRole}:${item.parentAccountId}`;
      children.set(key, [...(children.get(key) ?? []), item]);
    } else roots.push(item);
  }
  const output: BalanceSheetRow[] = [];
  const render = (item: PresentableBalanceSheetRow, depth: number, path: string[]): bigint => {
    const key = `${item.row.accountRole}:${item.row.accountId}`;
    const descendants = (children.get(key) ?? []).sort(compare);
    const renderedChildren: BalanceSheetRow[] = [];
    let descendantsTotal = 0n;
    const prior = output.length;
    descendants.forEach(child => { descendantsTotal += render(child, depth + 1, [...path, item.row.label]); });
    renderedChildren.push(...output.splice(prior));
    const total = (item.row.amountMinor ?? 0n) + descendantsTotal;
    if (!includeZero && total === 0n && !descendants.length) return total;
    output.push({ ...item.row, depth, fullPath: [...path, item.row.label].join(' > ') }, ...renderedChildren);
    if (descendants.length) {
      const rowId = `SUBTOTAL:${item.row.accountRole}:${encodeURIComponent(item.row.accountId!)}:${asOfDate}` as BalanceSheetRow['rowId'];
      output.push({ ...item.row, rowId, rowType: 'SUBTOTAL', label: `Total for ${item.row.label}`, parentRowId: item.row.rowId, depth, amountMinor: total, detailKey: balanceSheetDetailKey(rowId), bold: true, derived: true });
    }
    return total;
  };
  roots.sort(compare).forEach(item => render(item, 1, []));
  invalidRows(input, invalid).sort(compare).forEach(item => output.push({ ...item.row, depth: 1, unclassified: true, fullPath: `Unclassified > ${item.row.label}` }));
  const grouped: BalanceSheetRow[] = [];
  let previousType: string | undefined;
  for (const row of output) {
    if (row.accountType !== previousType) {
      previousType = row.accountType;
      const definition = ACCOUNT_TYPE_CATALOG.find(item => item.accountType === row.accountType);
      if (definition) grouped.push({ rowId: accountTypeBalanceSheetRowId(definition.accountType, asOfDate), rowType: 'GROUP_HEADER', section: row.section, accountType: definition.accountType, label: definition.label, depth: 0, bold: true, derived: false, archived: false, unclassified: false });
    }
    grouped.push(row);
  }
  return { rows: grouped, invalidAccountIds: [...invalid].sort() };
}

function invalidRows(input: readonly PresentableBalanceSheetRow[], invalid: ReadonlySet<string>): PresentableBalanceSheetRow[] {
  return input.filter(item => invalid.has(item.row.accountId!) && (item.row.amountMinor ?? 0n) !== 0n);
}
