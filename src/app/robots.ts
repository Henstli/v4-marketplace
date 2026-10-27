import type { MetadataRoute } from 'next';

// Roboti vyhledávačů procházejí jen veřejné stránky. Účet, košík, zprávy a správa jsou za přihlášením
// a jejich procházení by jen zbytečně přidávalo požadavky na Vercel.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/', '/auth/', '/ucet', '/kosik', '/objednavky', '/zpravy', '/prodat', '/sprava', '/hlidani',
        '/prihlaseni', '/registrace', '/nove-heslo', '/zapomenute-heslo',
      ],
    },
    host: 'https://www.v4cards.com',
  };
}
