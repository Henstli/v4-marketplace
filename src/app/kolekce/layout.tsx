import { ALBUM_FONTS } from '@/lib/album/designs';
import '@/components/album/album.css';

// Písma názvů na deskách alb se načítají jen v Moje kolekce.
export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={ALBUM_FONTS} precedence="default" />
      {children}
    </>
  );
}
