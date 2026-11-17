import Link from 'next/link';

// A number you can click to see the lines behind it.
export function Drill({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="drill" href={href} title="See the lines behind this number">{children}</Link>;
}

// Link to the Database tab with these filters (empty values are dropped).
export const dbHref = (p: Record<string, string | undefined | false>) =>
  '/database?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
