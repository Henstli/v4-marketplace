import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteChrome } from '@/components/site/SiteChrome';
import { SiteFooter } from '@/components/site/SiteFooter';
import { CartProvider } from '@/components/cart/CartProvider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'V4cards · sběratelské karty', template: '%s · V4cards' },
  description: 'Kupujte a prodávejte hokejové karty, Pokémon a Magic s přehledem o cenách. Česko a Slovensko.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Písma podle design systému Trezor */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap"
        />
      </head>
      <body>
        <CartProvider>
          <SiteChrome><SiteHeader /></SiteChrome>
          <main>{children}</main>
          <SiteChrome><SiteFooter /></SiteChrome>
        </CartProvider>
      </body>
    </html>
  );
}
