import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev is exposed through an ngrok tunnel; Next 16 blocks cross-origin
  // requests to dev assets/HMR unless the origin is allowlisted.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app"],
};

export default nextConfig;
