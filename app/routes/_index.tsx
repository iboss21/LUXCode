import { json, type MetaFunction } from '@remix-run/cloudflare';
import { lazy, Suspense } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Header } from '~/components/header/Header';

const Chat = lazy(() => import('~/components/chat/Chat.client').then((m) => ({ default: m.Chat })));

export const meta: MetaFunction = () => {
  return [
    { title: 'luxCoder — Local AI Vibe Coding Studio' },
    {
      name: 'description',
      content:
        'Build full-stack apps in your browser with local AI. Ollama, Hugging Face, and 19+ providers — free, self-hosted, by The Lux Empire.',
    },
  ];
};

export const loader = () => json({});

/** luxCoder home — AI vibe coding in the browser */
export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-[#c9a96e]/10 via-transparent to-transparent"
        aria-hidden
      />
      <Header />
      <ClientOnly fallback={<BaseChat />}>
        {() => (
          <Suspense fallback={<BaseChat />}>
            <Chat />
          </Suspense>
        )}
      </ClientOnly>
    </div>
  );
}
