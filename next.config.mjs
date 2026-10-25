/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "fluent-ffmpeg",
      "@google/genai",
      "googleapis",
      "google-auth-library",
      "ffmpeg-static",
    ],
    outputFileTracingIncludes: {
      "/api/videos/process": ["./node_modules/ffmpeg-static/ffmpeg"],
      "/api/videos/[id]": ["./node_modules/ffmpeg-static/ffmpeg"],
      "/api/scheduler/run": ["./node_modules/ffmpeg-static/ffmpeg"],
    },
  },
};

export default nextConfig;
