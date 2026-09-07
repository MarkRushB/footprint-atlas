import type { NextConfig } from 'next';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
const pagesBase = process.env.GITHUB_ACTIONS === 'true' && repository ? `/${repository}` : '';
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  assetPrefix: pagesBase,
  images: { unoptimized: true },
};

export default nextConfig;
