import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
    turbo: {
      // Turbopack 간단한 설정만 유지
      // TypeScript 오류가 발생하지 않도록 수정
    }
  },
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
      {
        protocol: 'https',
        hostname: 'ywvoksfszaelkceectaa.supabase.co',
        pathname: '/storage/v1/object/public/images/**',
      },
    ],
  },
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    ENABLE_DEV_LOGGING: process.env.ENABLE_DEV_LOGGING,
    PORT: '3000', // 포트 설정 추가
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  headers: async () => {
    return [
      {
        source: '/api/auth/session',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
  serverRuntimeConfig: {
    port: 3000,
  },
};

export default nextConfig;
