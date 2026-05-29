import { classNames } from '~/utils/classNames';

interface LuxCoderLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function LuxCoderLogo({ className, size = 'md' }: LuxCoderLogoProps) {
  const markSize = size === 'sm' ? 'w-7 h-7 text-sm' : size === 'lg' ? 'w-10 h-10 text-xl' : 'w-8 h-8 text-base';
  const textSize = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-2xl';

  return (
    <span className={classNames('inline-flex items-center gap-2.5 select-none', className)}>
      <span
        className={classNames(
          'flex items-center justify-center rounded-md font-bold leading-none shrink-0',
          'bg-[#c9a96e] text-[#080808]',
          markSize,
        )}
        aria-hidden
      >
        L
      </span>
      <span className={classNames('font-semibold tracking-tight', textSize)}>
        <span className="text-[#c9a96e]">lux</span>
        <span className="text-bolt-elements-textPrimary">Coder</span>
      </span>
    </span>
  );
}
