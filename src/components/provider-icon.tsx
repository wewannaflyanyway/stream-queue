import type { MusicProvider } from '@/lib/music-provider';

interface ProviderIconProps {
  provider: MusicProvider;
  className?: string;
}

export default function ProviderIcon({ provider, className }: ProviderIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {provider === 'youtube' ? (
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M6 4.25h12a5 5 0 0 1 5 5v5.5a5 5 0 0 1-5 5H6a5 5 0 0 1-5-5v-5.5a5 5 0 0 1 5-5ZM10 8.5v7l6-3.5-6-3.5Z"
        />
      ) : (
        <>
          <circle cx="12" cy="12" r="11" fill="currentColor" />
          <g fill="none" stroke="var(--provider-icon-detail, #121212)" strokeLinecap="round">
            <path d="M5.75 9.2c4.2-1.3 8.4-1 12.3 1" strokeWidth="1.9" />
            <path d="M6.5 12.5c3.5-1.1 7.2-.8 10.5.8" strokeWidth="1.65" />
            <path d="M7.25 15.6c2.8-.8 5.8-.6 8.5.7" strokeWidth="1.45" />
          </g>
        </>
      )}
    </svg>
  );
}
