import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

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
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
