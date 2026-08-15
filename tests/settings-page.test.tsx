// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/renderer/src/components/Pages";
import type {
  AppBuildInfo,
  AppSettings,
  LibraryStatus,
} from "../src/shared/contracts";

const settings: AppSettings = {
  libraryPath: "C:\\osu",
  theme: "dark",
  density: "comfortable",
  scanOnStartup: false,
  protectedWriteMode: true,
};

const status: LibraryStatus = {
  configuredPath: settings.libraryPath,
  detectedCandidates: [],
  capabilities: {
    adapter: "test adapter",
    readMetadata: true,
    readCollections: false,
    readPlayHistory: true,
    accurateStorage: true,
    writeLibrary: true,
    limitations: [],
  },
  osuIsRunning: false,
  lastScanAt: "2026-08-15T12:00:00.000Z",
  indexedDifficulties: 12,
  scanInProgress: false,
};

const build: AppBuildInfo = {
  version: "0.2.0",
  commit: "test",
  channel: "development",
  builtAt: "2026-08-15T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsPage theme selection", () => {
  it("exposes a labelled theme group and updates explicit and system choices", () => {
    vi.stubGlobal("React", React);
    const onUpdate = vi.fn(() => Promise.resolve());

    render(
      React.createElement(SettingsPage, {
        settings,
        status,
        build,
        onUpdate,
        onChooseLibrary: vi.fn(() => Promise.resolve()),
        onScan: vi.fn(() => Promise.resolve()),
        onOpenDocs: vi.fn(),
      }),
    );

    expect(
      screen.getByRole("group", { name: "Application theme" }),
    ).toBeTruthy();
    const light = screen.getByRole<HTMLInputElement>("radio", {
      name: "Light",
    });
    const dark = screen.getByRole<HTMLInputElement>("radio", {
      name: "Dark",
    });
    const system = screen.getByRole<HTMLInputElement>("radio", {
      name: "System",
    });
    expect(light.checked).toBe(false);
    expect(dark.checked).toBe(true);
    expect(system.checked).toBe(false);

    fireEvent.click(light);
    expect(onUpdate).toHaveBeenCalledWith({ theme: "light" });

    fireEvent.click(system);
    expect(onUpdate).toHaveBeenLastCalledWith({ theme: "system" });
  });
});
