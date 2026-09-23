// App updates — the build-time half (the runtime half is src/lib/updates.tsx).
//
// OTA goes through Codemagic Patch on our self-hosted server (https://patch.fadymondy.com), the
// same arrangement as the Fady Mondy and Health Debug apps. One Patch app per platform — `mahaam`
// (iOS) and `mahaam-android` — each with a Staging and a Production deployment. Deployment keys are
// PUBLIC identifiers (they ship inside the binary), so they are committed below once the apps exist;
// until then they are empty and OTA is simply OFF for that platform: the Patch plugin is not
// applied, the native entry points are left alone, and the app never calls the SDK.
//
// Store builds embed Production; PATCH_DEPLOYMENT=Staging builds a test binary that follows Staging.
// Every key can also come from the environment (PATCH_IOS_PRODUCTION_KEY, …), which wins.
//
// SIGNED RELEASES ONLY. The public key (patch-public-key.pem, committed; the same one the other apps
// use) is compiled into the binary and the SDK rejects any release it did not sign. The private key
// lives only in Codemagic (CODEMAGIC_PATCH_PRIVATE_KEY, group `patch`); never in this repo.
//
// expo-updates stays installed (the synced grid calls Updates.reloadAsync for its RTL reload) but
// must stay DISABLED: with an `updates.url` it owns bundle loading and Patch bundles would never
// boot. Refused here.
const fs = require("fs");
const path = require("path");
const { withPlugins } = require("expo/config-plugins");

// Fill from `cmpatch deployment list --app <app> --format table` (the DEPLOYMENT_KEY column).
const PATCH_KEYS = {
  ios: { Staging: "", Production: "" },
  android: { Staging: "", Production: "" },
};

const PATCH_SERVER = {
  apiUrl: process.env.PATCH_API_URL || "https://patch.fadymondy.com",
  downloadBaseUrl: process.env.PATCH_DOWNLOAD_URL || "https://storage-patch.fadymondy.com/codemagic-patch",
};

const PUBLIC_KEY_FILE = path.join(__dirname, "..", "patch-public-key.pem");

function deployment() {
  const d = (process.env.PATCH_DEPLOYMENT || "Production").trim();
  if (d !== "Production" && d !== "Staging") throw new Error(`with-app-updates: PATCH_DEPLOYMENT must be "Production" or "Staging", got "${d}".`);
  return d;
}

function key(platform, dep) {
  const env = process.env[`PATCH_${platform.toUpperCase()}_${dep.toUpperCase()}_KEY`];
  return ((env ?? PATCH_KEYS[platform][dep]) || "").trim();
}

function publicKey() {
  if (!fs.existsSync(PUBLIC_KEY_FILE)) return "";
  // LF only: a Windows checkout gives the file CRLF, which would end up inside the embedded key.
  const pem = fs.readFileSync(PUBLIC_KEY_FILE, "utf8").replace(/\r\n?/g, "\n").trim();
  if (/PRIVATE KEY/.test(pem)) throw new Error("with-app-updates: patch-public-key.pem holds a PRIVATE key. Remove it from the repo now and rotate it.");
  return pem;
}

module.exports = function withAppUpdates(config) {
  if (config.updates && config.updates.url) {
    throw new Error(
      "with-app-updates: expo-updates has an updates.url, which makes it own bundle loading and would stop " +
        "Codemagic Patch bundles from ever booting. OTA goes through Codemagic Patch — remove updates.url.",
    );
  }
  const dep = deployment();
  const ios = key("ios", dep);
  const android = key("android", dep);
  const pem = ios || android ? publicKey() : "";
  if ((ios || android) && !pem) throw new Error("with-app-updates: a deployment key is set but patch-public-key.pem is missing. Releases must be signed.");

  config.extra = {
    ...(config.extra || {}),
    // Read by src/lib/updates.tsx: which platforms have a Patch deployment compiled in.
    appUpdates: { ota: { ios: !!ios, android: !!android, deployment: dep } },
  };
  const props = {
    ...(ios ? { ios: { deploymentKey: ios, publicKey: pem, ...PATCH_SERVER } } : {}),
    ...(android ? { android: { deploymentKey: android, publicKey: pem, ...PATCH_SERVER } } : {}),
  };
  return ios || android ? withPlugins(config, [["@codemagic/react-native-patch", props]]) : config;
};
