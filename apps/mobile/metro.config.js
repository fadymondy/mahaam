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

module.exports = config;
