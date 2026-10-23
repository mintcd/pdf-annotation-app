import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import eruda from 'vite-plugin-eruda';
import { randomUUID } from 'node:crypto';
import { syncEngineVinext } from '@mintcd/sync-engine-vinext/vite';

export default defineConfig(({ command }) => ({
  define: {
    __SYNC_PRODUCTION__: JSON.stringify(command === 'build'),
    __SYNC_DEPLOYMENT_VERSION__: JSON.stringify(process.env.SYNC_DEPLOYMENT_VERSION ?? (command === 'build' ? randomUUID() : 'development')),
  },
  server: {
    host: "0.0.0.0",
    forwardConsole: true
  },
  preview: {
    host: "0.0.0.0",
  },
  plugins: [
    syncEngineVinext(),
    vinext(),
    eruda(),
    cloudflare({
      remoteBindings: process.env.SYNC_REMOTE_BINDINGS === 'true',
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
}));
