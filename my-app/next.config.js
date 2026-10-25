/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip expensive checks in runtime builds; CI already validates types/lint
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  serverExternalPackages: ["pdf-parse", "sharp", "tesseract.js"],
  httpAgentOptions: {
    keepAlive: true,
  },
  
  // Moved from experimental to top level (Next.js 15+)
  outputFileTracingExcludes: {
    "*": ["piper-bin/**"],
  },
  
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Handle tesseract.js worker files
      config.resolve.alias = {
        ...config.resolve.alias,
        "tesseract.js": require.resolve("tesseract.js"),
      };
    }

    // Ignore node-specific modules in the browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };

    // Silence known onnxruntime-web dynamic require warnings from the VAD lib
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules[\\/]onnxruntime-web/,
        message: /Critical dependency: require function is used in a way in which dependencies cannot be statically extracted/,
      },
    ];

    // Exclude piper-bin directory from webpack processing
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules', '**/piper-bin/**'],
    };

    return config;
  },
};

module.exports = nextConfig;