import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships ESM with dynamic worker imports; keep it out of the server bundle.
  serverExternalPackages: ["pdfjs-dist"],
  // three.js and friends are large; transpile only what's needed on the client.
  transpilePackages: ["three"],
};

export default nextConfig;
