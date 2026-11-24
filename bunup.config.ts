import { defineConfig } from "bunup";

// Single ESM entry, bundled for Node. Dependencies stay external (bunup default)
export default defineConfig({
  entry: ["src/node-nats-streaming-buffered-client.ts"],
  dts: {
    inferTypes: true,
  },
});
