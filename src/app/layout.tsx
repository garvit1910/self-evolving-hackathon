import type { Metadata } from 'next';
import './globals.css';
import { dataSource } from '@/lib/datasource';
import { AutopilotProvider } from '@/components/autopilot/provider';
import { AutopilotStepper } from '@/components/autopilot/stepper';
import { Nav } from '@/components/shell/nav';
import { Topbar } from '@/components/shell/topbar';

export const metadata: Metadata = {
  title: 'Adcero — Self-Evolving Ad Engine',
  description: 'Brand in, evolving ads out. Offline fixture demo.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await dataSource.getBrand();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <AutopilotProvider>
          <div className="flex min-h-screen">
            <Nav />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar brand={brand} />
              <AutopilotStepper />
              <main className="min-w-0 flex-1">{children}</main>
            </div>
          </div>
        </AutopilotProvider>
      </body>
    </html>
  );
}
