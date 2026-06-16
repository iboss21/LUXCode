import { json, type LoaderFunction } from '@remix-run/cloudflare';
import { discoverLocalAi } from '~/lib/local-ai/discovery';

export const loader: LoaderFunction = async ({ context }) => {
  const env = (context?.cloudflare?.env ?? process.env) as unknown as Record<string, string | undefined>;
  const result = await discoverLocalAi(env);

  return json(result);
};
