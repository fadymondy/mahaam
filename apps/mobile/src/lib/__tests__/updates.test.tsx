import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { GridBridge, StringsProvider } from "@/grid";
import { APP } from "@/grid.config";
import { strings } from "@/i18n";
import { CHECK_INTERVAL_MS, previewView, shouldCheck, UpdateBanner, UpdateLoader, updateView, type UpdateView } from "../updates";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockUpdates = {
  isDownloading: false,
  isUpdatePending: false,
  isRestarting: false,
  downloadProgress: undefined as number | undefined,
  downloadedUpdate: undefined as { updateId: string } | undefined,
};
jest.mock("expo-updates", () => ({
  isEnabled: false,
  useUpdates: () => mockUpdates,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(() => Promise.resolve()),
}));

const base = { reason: "foreground" as const, dev: false, enabled: true, busy: false, pending: false, lastCheckAt: 0, now: CHECK_INTERVAL_MS };

describe("shouldCheck", () => {
  it("never checks in development or without an updates runtime", () => {
    expect(shouldCheck({ ...base, reason: "launch", dev: true })).toBe(false);
    expect(shouldCheck({ ...base, reason: "launch", enabled: false })).toBe(false);
  });
  it("always checks at launch", () => {
    expect(shouldCheck({ ...base, reason: "launch", lastCheckAt: base.now })).toBe(true);
  });
  it("checks on foreground once the interval has passed", () => {
    expect(shouldCheck({ ...base, lastCheckAt: null })).toBe(true);
    expect(shouldCheck(base)).toBe(true);
    expect(shouldCheck({ ...base, lastCheckAt: 1 })).toBe(false);
  });
  it("does not start a second check or fetch past a pending update", () => {
    expect(shouldCheck({ ...base, reason: "launch", busy: true })).toBe(false);
    expect(shouldCheck({ ...base, reason: "launch", pending: true })).toBe(false);
  });
});

describe("updateView", () => {
  const s = { isDownloading: false, isUpdatePending: false, pendingId: null, laterId: null };
  it("is hidden when idle", () => expect(updateView(s)).toEqual({ kind: "hidden" }));
  it("shows download progress as a percentage, or a spinner while unknown", () => {
    expect(updateView({ ...s, isDownloading: true, downloadProgress: 0.416 })).toEqual({ kind: "downloading", progress: 42 });
    expect(updateView({ ...s, isDownloading: true, downloadProgress: 0 })).toEqual({ kind: "downloading", progress: null });
    expect(updateView({ ...s, isDownloading: true })).toEqual({ kind: "downloading", progress: null });
  });
  it("asks once an update is downloaded, until Later for that update", () => {
    expect(updateView({ ...s, isUpdatePending: true, pendingId: "u1" })).toEqual({ kind: "ready" });
    expect(updateView({ ...s, isUpdatePending: true, pendingId: "u1", laterId: "u1" })).toEqual({ kind: "hidden" });
    // A newer update than the one put off asks again.
    expect(updateView({ ...s, isUpdatePending: true, pendingId: "u2", laterId: "u1" })).toEqual({ kind: "ready" });
  });
  it("hides while restarting", () => {
    expect(updateView({ ...s, isUpdatePending: true, pendingId: "u1", isRestarting: true })).toEqual({ kind: "hidden" });
  });
});

describe("previewView", () => {
  it("parses the development preview switch", () => {
    expect(previewView(undefined)).toBeNull();
    expect(previewView("nope")).toBeNull();
    expect(previewView("ready")).toEqual({ kind: "ready" });
    expect(previewView("downloading")).toEqual({ kind: "downloading", progress: null });
    expect(previewView("downloading:0.42")).toEqual({ kind: "downloading", progress: 42 });
  });
});

function Wrap({ locale, children }: { locale: "en" | "ar"; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } }}>
      <GridBridge app={APP} theme="light" locale={locale} isRTL={locale === "ar"}>
        <StringsProvider strings={strings}>{children}</StringsProvider>
      </GridBridge>
    </SafeAreaProvider>
  );
}

describe("UpdateBanner", () => {
  const noop = () => undefined;
  const show = (view: UpdateView, locale: "en" | "ar" = "en") =>
    render(
      <Wrap locale={locale}>
        <UpdateBanner view={view} onRestart={noop} onLater={noop} />
      </Wrap>,
    );

  it("renders nothing when hidden", async () => {
    await show({ kind: "hidden" });
    expect(screen.queryByText(/update/i)).toBeNull();
  });
  it("shows the download pill with progress", async () => {
    await show({ kind: "downloading", progress: 42 });
    expect(screen.getByText("Downloading update…")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });
  it("shows the download pill without progress", async () => {
    await show({ kind: "downloading", progress: null });
    expect(screen.getByText("Downloading update…")).toBeTruthy();
    expect(screen.queryByText(/%$/)).toBeNull();
  });
  it("prompts to restart, and says Later installs it on the next start", async () => {
    await show({ kind: "ready" });
    expect(screen.getByText("Update ready")).toBeTruthy();
    expect(screen.getByText(/next time you open Mahaam/)).toBeTruthy();
    expect(screen.getByText("Restart now")).toBeTruthy();
    expect(screen.getByText("Later")).toBeTruthy();
  });
  it("speaks Arabic", async () => {
    await show({ kind: "ready" }, "ar");
    expect(screen.getByText("التحديث جاهز")).toBeTruthy();
    expect(screen.getByText("أعد التشغيل الآن")).toBeTruthy();
    expect(screen.getByText("لاحقًا")).toBeTruthy();
  });
});

describe("UpdateLoader", () => {
  afterEach(() => Object.assign(mockUpdates, { isDownloading: false, isUpdatePending: false, downloadProgress: undefined, downloadedUpdate: undefined }));

  it("follows the updater: downloading, then ready; Restart now reloads", async () => {
    Object.assign(mockUpdates, { isDownloading: true, downloadProgress: 0.5 });
    const r = await render(
      <Wrap locale="en">
        <UpdateLoader />
      </Wrap>,
    );
    expect(screen.getByText("50%")).toBeTruthy();

    Object.assign(mockUpdates, { isDownloading: false, isUpdatePending: true, downloadedUpdate: { updateId: "u1" } });
    await r.rerender(
      <Wrap locale="en">
        <UpdateLoader />
      </Wrap>,
    );
    await fireEvent.press(screen.getByText("Restart now"));
    expect(require("expo-updates").reloadAsync).toHaveBeenCalled();
  });

  it("Later hides the prompt for that update", async () => {
    Object.assign(mockUpdates, { isUpdatePending: true, downloadedUpdate: { updateId: "u1" } });
    await render(
      <Wrap locale="en">
        <UpdateLoader />
      </Wrap>,
    );
    await fireEvent.press(screen.getByText("Later"));
    expect(screen.queryByText("Update ready")).toBeNull();
  });
});
