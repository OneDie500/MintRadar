import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.mintradar.mobile",
  appName: "MintRadar",
  webDir: "public",

  server: {
    url: "https://mint-radar-git-mobile-print-infrastructure-mint-radar.vercel.app",
  },
};

export default config;
