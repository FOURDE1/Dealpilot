/**
 * The inventory the assistant is allowed to know about (conversation-engine.md
 * §10, guardrail 1: "data starvation").
 *
 * The model cannot leak numbers it never sees. Every other defence in §10 —
 * the prompt prohibition, the outbound guard, tool-result grounding — is a
 * filter on what the model produces; this one removes the material. It is the
 * only one that cannot be talked around, because there is nothing to talk it
 * into revealing.
 *
 * So this function takes rows as they come out of the database, prices and
 * costs and all, and builds the summary from an ALLOW-list. A deny-list would
 * be one migration away from leaking: add `msrp_cents` next month and a
 * "remove the price fields" implementation quietly starts including it.
 */

/** A row as the database has it — anything at all, including money. */
export type RawUnit = Readonly<Record<string, unknown>>;

/**
 * The only facts about a vehicle that reach the model.
 *
 * §3 block 4: "stock #, year/make/model/trim, km — no prices". §4's
 * `lookup_inventory` adds the first photo, for MMS.
 */
export const VISIBLE_UNIT_FIELDS = [
  'stock_number',
  'year',
  'make',
  'model',
  'trim',
  'mileage_km',
] as const;

export interface VisibleUnit {
  readonly stock_number: string;
  readonly year: number | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly trim: string | null;
  readonly mileage_km: number | null;
}

/** §3: the top 50 available units go in block 4. */
export const INVENTORY_SUMMARY_LIMIT = 50;
/** §4: `lookup_inventory` returns at most three. */
export const LOOKUP_INVENTORY_LIMIT = 3;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Keep only what the model may see.
 *
 * Throws when a unit has no stock number: §10 guardrail 4 grounds every vehicle
 * mention in a tool result by stock number, and a unit the outbound guard
 * cannot match is a unit the guard will call invented.
 */
export function visibleUnit(raw: RawUnit): VisibleUnit {
  const stock = str(raw['stock_number']);
  if (!stock) throw new Error('inventory unit has no stock_number; it cannot be grounded or guarded');
  return {
    stock_number: stock,
    year: num(raw['year']),
    make: str(raw['make']),
    model: str(raw['model']),
    trim: str(raw['trim']),
    mileage_km: num(raw['mileage_km']),
  };
}

/**
 * One line per vehicle, in §10 guardrail 4's template.
 *
 * The model composes replies FROM this rather than describing cars freely, so
 * the shape here is the shape a customer eventually reads.
 */
export function unitLine(unit: VisibleUnit): string {
  const name = [unit.year, unit.make, unit.model, unit.trim].filter(Boolean).join(' ');
  const km = unit.mileage_km === null ? '' : ` — ${unit.mileage_km.toLocaleString('en-CA')} km`;
  return `${unit.stock_number}: ${name || 'unspecified'}${km}`;
}

export function summariseInventory(
  units: readonly RawUnit[],
  limit = INVENTORY_SUMMARY_LIMIT,
): string {
  const lines = units.slice(0, limit).map((u) => unitLine(visibleUnit(u)));
  if (lines.length === 0) return 'No vehicles are currently available.';
  return lines.join('\n');
}
