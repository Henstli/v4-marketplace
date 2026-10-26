import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Obrázky obchodů z bucketu shop-media se zmenšují přes /_next/image (viz mediaImage).
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/shop-media/**' }],
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;
