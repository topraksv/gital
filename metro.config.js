// Drizzle's migrations import .sql files; expo-sqlite's web driver ships a wasm asset.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("sql");
config.resolver.assetExts.push("wasm");

/**
 * The environments `@expo/metro-config` renders to a string rather than to a
 * screen: "node" for the static HTML pass, "react-server" for RSC.
 */
const SERVER_ENVIRONMENTS = new Set(["node", "react-server"]);

const SERVER_SQLITE_STUB = path.resolve(__dirname, "src/db/expo-sqlite.server.js");

/**
 * A server render has no database, so its bundle does not carry the driver.
 * Helix's (`~/helix/metro.config.js`): `web.output` is "static", every route is
 * rendered once in Node, and that pass pulled expo-sqlite's Web Worker into a
 * bundle that cannot chunk one. The stub says what it answers with.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "expo-sqlite" && SERVER_ENVIRONMENTS.has(context.customResolverOptions?.environment)) {
    return { type: "sourceFile", filePath: SERVER_SQLITE_STUB };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
