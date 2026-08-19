import { useQuery } from '@tanstack/react-query';
import { MeResponse } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from './client.js';

export const ME_KEY = ['me'] as const;

/** The session probe with the F-41 MFA flags — shared by the shell (banner) and /security. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.auth.me, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return MeResponse.parse(res.body);
    },
  });
}
