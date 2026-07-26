import { describe, expect, it } from 'vitest';
import { canAdvanceDocument, requiredDocuments, wetInkComplete, wetInkPrepared, type DealShape } from './documents.js';

/**
 * F-13 document rules — golden cases from documents.md §2/§3/§4. The legacy
 * code is the executable spec (ADR-026); these encode what it does.
 */

const base: DealShape = {
  dealType: 'cash',
  province: 'QC',
  tradeLienCents: 0,
  soldAsIs: false,
  billOfSaleSystem: 'CAMS',
};

const types = (d: DealShape) => requiredDocuments(d).map((x) => x.type);

describe('which documents a deal needs (§3)', () => {
  it('every deal carries the base four', () => {
    expect(types(base).sort()).toEqual(
      ['bill_of_sale', 'odometer_statement', 'privacy_consent', 'vehicle_condition'].sort(),
    );
  });

  it('a financed deal adds the bank contract; a cash deal does not', () => {
    expect(types({ ...base, dealType: 'finance' })).toContain('bank_contract');
    expect(types(base)).not.toContain('bank_contract');
  });

  it('a lease adds the lease agreement, not a bank contract', () => {
    const t = types({ ...base, dealType: 'lease' });
    expect(t).toContain('lease_agreement');
    expect(t).not.toContain('bank_contract');
  });

  it('Ontario adds the OMVIC disclosure; Quebec does not', () => {
    expect(types({ ...base, province: 'ON' })).toContain('omvic_disclosure');
    expect(types(base)).not.toContain('omvic_disclosure');
  });

  it('a trade WITH A LIEN adds the payoff authorization', () => {
    // Somebody else is owed money on that car and must be paid from the
    // proceeds; without this the payoff cannot be made.
    expect(types({ ...base, tradeLienCents: 500_000 })).toContain('trade_in_lien_authorization');
    expect(types(base)).not.toContain('trade_in_lien_authorization');
  });

  it('an as-is sale adds the waiver — the safety exemption depends on it', () => {
    // delivery.md §2.2: an as-is deal may skip the safety hard block ONLY
    // because this disclosure is in the file.
    expect(types({ ...base, soldAsIs: true })).toContain('as_is_waiver');
  });

  it('a used vehicle adds a Carfax that nobody signs', () => {
    const docs = requiredDocuments({ ...base, vehicleType: 'used' });
    const carfax = docs.find((d) => d.type === 'carfax_report')!;
    expect(carfax.requiresSignature).toBe(false);
    // Treating it as unsigned would block every used-car delivery forever.
    expect(requiredDocuments({ ...base, vehicleType: 'new' }).map((d) => d.type))
      .not.toContain('carfax_report');
  });

  it('one agreement per F&I product, named so a clerk can tell them apart', () => {
    const docs = requiredDocuments({
      ...base,
      fiProducts: [
        { kind: 'warranty', name: 'Safe-Guard 5yr' },
        { kind: 'gap', name: 'Safe-Guard GAP' },
        { kind: 'aftermarket', name: 'Rustproofing' },
        { kind: 'aftermarket', name: 'Paint protection' },
      ],
    });
    expect(docs.filter((d) => d.type === 'aftermarket_agreement')).toHaveLength(2);
    expect(docs.find((d) => d.type === 'gap_agreement')!.name).toContain('Safe-Guard GAP');
    // Two aftermarket agreements must not be indistinguishable in a file.
    const names = docs.filter((d) => d.type === 'aftermarket_agreement').map((d) => d.name);
    expect(new Set(names).size).toBe(2);
  });

  it('the bill of sale comes from the store’s own system', () => {
    expect(requiredDocuments({ ...base, billOfSaleSystem: 'Merlin' })
      .find((d) => d.type === 'bill_of_sale')!.source).toBe('merlin');
    expect(requiredDocuments({ ...base, billOfSaleSystem: 'CAMS' })
      .find((d) => d.type === 'bill_of_sale')!.source).toBe('cams');
  });

  it('the file comes out in handover order', () => {
    const docs = requiredDocuments({ ...base, dealType: 'finance', province: 'ON', vehicleType: 'used' });
    const orders = docs.map((d) => d.sortOrder);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
    // The lender contract and the bill of sale lead; the unsigned report trails.
    expect(docs[0]!.type).toBe('bank_contract');
    expect(docs[docs.length - 1]!.type).toBe('carfax_report');
  });

  it('a fully-loaded Ontario financed deal gets everything at once', () => {
    const t = types({
      ...base, dealType: 'finance', province: 'ON', tradeLienCents: 100_000,
      soldAsIs: true, vehicleType: 'used',
      fiProducts: [{ kind: 'warranty', name: 'W' }],
    });
    for (const expected of [
      'bill_of_sale', 'privacy_consent', 'vehicle_condition', 'odometer_statement',
      'bank_contract', 'omvic_disclosure', 'trade_in_lien_authorization',
      'as_is_waiver', 'carfax_report', 'warranty_agreement',
    ]) {
      expect(t, `missing ${expected}`).toContain(expected);
    }
  });
});

describe('document lifecycle (§4)', () => {
  it('follows the real-world path', () => {
    expect(canAdvanceDocument('not_ready', 'generated')).toBe(true);
    expect(canAdvanceDocument('generated', 'e_signed')).toBe(true);
    expect(canAdvanceDocument('in_file', 'signed')).toBe(true);
    expect(canAdvanceDocument('signed', 'filed')).toBe(true);
  });

  it('e-signing is optional — a store may print and collect wet ink', () => {
    expect(canAdvanceDocument('generated', 'printed')).toBe(true);
  });

  it('the Carfax path skips signing — and ONLY for unsigned documents', () => {
    // not_ready → generated → in_file → filed, for requires_signature = false.
    expect(canAdvanceDocument('generated', 'in_file', false)).toBe(true);
    expect(canAdvanceDocument('in_file', 'filed', false)).toBe(true);

    // A signature document must NOT be able to take that shortcut. Allowing it
    // let a bank contract reach `filed` — and count as complete — with
    // signed_at_delivery NULL: the record would say a customer signed something
    // nobody watched them sign.
    expect(canAdvanceDocument('generated', 'in_file', true)).toBe(false);
    expect(canAdvanceDocument('in_file', 'filed', true)).toBe(false);
    expect(canAdvanceDocument('in_file', 'signed', true)).toBe(true);
  });

  it('a file is READY TO TRAVEL once printed, not once signed', () => {
    // The distinction the whole gate turns on: `signed` happens AT the delivery,
    // so requiring it before dispatch demands an outcome that can only exist
    // after the trip it is authorizing.
    const printed = [{ requiresSignature: true, status: 'printed' }];
    expect(wetInkPrepared(printed)).toBe(true);
    expect(wetInkComplete(printed)).toBe(false);

    expect(wetInkPrepared([{ requiresSignature: true, status: 'generated' }])).toBe(false);
    // No list at all is "not applicable", not "not ready".
    expect(wetInkPrepared([])).toBeNull();
  });

  it('cannot go backwards, and a filed document is done', () => {
    expect(canAdvanceDocument('signed', 'printed')).toBe(false);
    expect(canAdvanceDocument('filed', 'signed')).toBe(false);
    expect(canAdvanceDocument('not_ready', 'signed')).toBe(false);
  });
});

describe('is the wet-ink file complete?', () => {
  it('needs every signature document signed', () => {
    expect(wetInkComplete([
      { requiresSignature: true, status: 'signed' },
      { requiresSignature: true, status: 'in_file' },
    ])).toBe(false);
    expect(wetInkComplete([
      { requiresSignature: true, status: 'signed' },
      { requiresSignature: true, status: 'filed' },
    ])).toBe(true);
  });

  it('an unsigned document only has to be IN the file', () => {
    // Otherwise a Carfax would block every used-car delivery, forever.
    expect(wetInkComplete([
      { requiresSignature: true, status: 'signed' },
      { requiresSignature: false, status: 'in_file' },
    ])).toBe(true);
  });

  it('no documents means "not applicable", not "incomplete"', () => {
    // Deals written before F-13 must not become undeliverable because a table
    // arrived after them.
    expect(wetInkComplete([])).toBeNull();
  });
});
