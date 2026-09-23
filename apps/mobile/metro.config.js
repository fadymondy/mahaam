// Keeps Metro's file watcher out of the native build trees.
//
// `expo prebuild` generates android/ and ios/ inside the project, and a Gradle build fills them
// with tens of thousands of files. Metro crawls the project root, so without this it pegs a core
// and the app sits on a blank screen waiting for a bundle. `resolver.blockList` is also the file
// map's ignore pattern, so this stops the crawl too.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const blocked = [
  /[\\/]android[\\/](app[\\/]build|build|\.gradle|\.cxx|app[\\/]\.cxx)[\\/].*/,
  /[\\/]ios[\\/](build|Pods|DerivedData)[\\/].*/,
  /.*\.log$/,
];

const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...blocked];

// @mahaam/react-native is installed from its public repo (pinned commit), which ships TypeScript
// sources, not the dist/ its package exports point at. Resolve the package and its subpaths to
// src/; Metro compiles node_modules TypeScript like our own.
const path = require('path');
const MAHAAM_SDK = path.join(__dirname, 'node_modules/@mahaam/react-native/src');
const SDK_ENTRIES = { '': 'index.ts', '/boundary': 'boundary.ts', '/feedback': 'feedback.ts', '/feedback-ui': 'feedback-ui.tsx' };
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === '@mahaam/react-native' || name.startsWith('@mahaam/react-native/')) {
    const file = SDK_ENTRIES[name.slice('@mahaam/react-native'.length)];
    if (file) return { type: 'sourceFile', filePath: path.join(MAHAAM_SDK, file) };
  }
  return resolveRequest ? resolveRequest(context, name, platform) : context.resolveRequest(context, name, platform);
};

module.exports = config;
