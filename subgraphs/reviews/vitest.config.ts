import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// Pothos/Apollo load the CommonJS build of `graphql`; without this alias vitest would
// load a second, ESM copy for our own imports and class checks (instanceof) would fail.
const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: { alias: { graphql: require.resolve("graphql") } },
});
