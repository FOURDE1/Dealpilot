import { LENDER_CATEGORIES, type LenderCategoryT, type LenderT } from '@dealpilot/schemas';

/**
 * F-80 — the desking « Prêteur » Select's option model, pure (the
 * comms-window.ts pattern: logic out of the page, tested beside it).
 *
 * The ruled posture (graft 6 + A11):
 *  - while the list is PENDING: the Select is disabled and offers only the
 *    current/none option — no layout shift, no invented list;
 *  - on list ERROR with a deal naming a lender: the current option renders as
 *    '…' (the render sites' own fallback); the save still works and lender_id
 *    is simply unchanged. Never a uuid in the Select, never a silent clear;
 *  - on success: lenders grouped by category in spec order, inactive lenders
 *    hidden from NEW picks; the deal's CURRENT lender stays selectable,
 *    suffixed « (inactif) » when deactivated (§1.1 honest history).
 */
export interface LenderSelectModel {
  readonly disabled: boolean;
  /**
   * A fallback option for the current pick when the loaded list cannot name it
   * (pending, error, or — defensively — a row the list is missing). null when
   * nothing is picked or the pick renders inside its own group.
   */
  readonly current: { readonly value: string; readonly label: string } | null;
  readonly groups: readonly {
    readonly category: LenderCategoryT;
    readonly options: readonly { readonly value: string; readonly label: string }[];
  }[];
}

export function deskingLenderSelect(
  list: { isPending: boolean; isError: boolean; items: readonly LenderT[] | undefined },
  currentId: string,
  inactiveSuffix: string,
): LenderSelectModel {
  const items = list.items ?? [];
  if (list.isPending || list.isError || list.items === undefined) {
    return {
      disabled: list.isPending,
      current: currentId === '' ? null : { value: currentId, label: '…' },
      groups: [],
    };
  }
  const groups = LENDER_CATEGORIES.map((category) => ({
    category,
    options: items
      .filter((l) => l.category === category && (l.active || l.id === currentId))
      .map((l) => ({
        value: l.id,
        label: l.active ? l.name : `${l.name} ${inactiveSuffix}`,
      })),
  })).filter((g) => g.options.length > 0);
  const currentListed = currentId !== '' && items.some((l) => l.id === currentId);
  return {
    disabled: false,
    current: currentId === '' || currentListed ? null : { value: currentId, label: '…' },
    groups,
  };
}
