/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "fluent-ffmpeg",
      "@google/genai",
      "googleapis",
      "google-auth-library",
    ],
  },
};

export default nextConfig;
