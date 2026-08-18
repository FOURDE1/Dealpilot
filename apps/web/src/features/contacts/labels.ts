import type { ContactT } from '@dealpilot/schemas';

/**
 * A contact's display name, from whatever identity fragments exist.
 *
 * Both names are nullable — a contact can be created from a lead that only had
 * a phone number — so the fallbacks go name → phone → email → the caller's
 * "unnamed" label. Never an empty string: an empty link is invisible AND
 * unclickable, which for a screen-reader user is a row that does not exist.
 */
export function contactDisplayName(
  c: Pick<ContactT, 'first_name' | 'last_name' | 'phone' | 'email'>,
  unnamed: string,
): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return name !== '' ? name : (c.phone ?? c.email ?? unnamed);
}
