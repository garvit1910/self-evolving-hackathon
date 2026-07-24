'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/research', label: 'Research' },
  { href: '/context', label: 'Context' },
  { href: '/studio', label: 'Studio' },
  { href: '/market', label: 'Market' },
  { href: '/learnings', label: 'Learnings' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-line bg-panel">
      <Link href="/" className="flex items-center gap-2 border-b border-line px-5 py-4">
        <span className="inline-block h-2 w-2 bg-accent" />
        <span className="font-mono text-sm font-bold tracking-[0.25em] text-fg">SWARMADS</span>
      </Link>
      <nav className="flex flex-col gap-0.5 p-2">
        {LINKS.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-sm px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-panel2 font-medium text-accent'
                  : 'text-mut hover:bg-panel2 hover:text-fg'
              }`}
            >
              <span className="mr-2 font-mono text-[10px] text-dim">
                {String(LINKS.findIndex((l) => l.href === href) + 1).padStart(2, '0')}
              </span>
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-line p-4">
        <p className="font-mono text-[10px] leading-relaxed text-dim">
          FIXTURE MODE
          <br />
          OFFLINE · SEED 42
        </p>
      </div>
    </aside>
  );
}
