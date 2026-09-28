const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Edge TTS uses a Node WebSocket implementation that must stay server-side.
    serverComponentsExternalPackages: ['msedge-tts', 'playwright-core'],
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  // 允许 data/ 目录下的图片/音频被 /api/data/[...path] 路由处理
  async rewrites() {
    return [
      // 静态资源走 Next.js public/ 目录即可
    ];
  },
};

// Keep development chunks separate from production builds. Running `next build`
// while the local app is open must not invalidate the browser's dev assets.
module.exports = phase => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
