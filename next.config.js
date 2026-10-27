/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'pdf-parse'] },
  webpack: (config) => {
    // pdf-parse tries to require 'canvas' in test utils — alias to false to prevent error
    config.resolve.alias = { ...config.resolve.alias, canvas: false }
    return config
  },
  // A aba "Fluxo Projetado" virou "Fluxo de Caixa"; o endereço antigo continua valendo.
  async redirects() {
    return [{ source: '/fluxo-projetado', destination: '/fluxo-caixa', permanent: false }]
  },
}
module.exports = nextConfig
