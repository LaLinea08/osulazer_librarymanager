// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedDeletionModal } from "../src/renderer/src/components/DeletionModal";
import {
  DEFAULT_QUERY,
  type DeletionPolicy,
  type DeletionPreview,
  type SerializableSelection,
} from "../src/shared/contracts";

const selection: SerializableSelection = {
  mode: "explicit",
  included: ["difficulty-1"],
  excluded: [],
};

function previewFor(policy: DeletionPolicy): DeletionPreview {
  const protectedMode = policy.protectPlayedSets;
  return {
    previewId: protectedMode ? "protected-preview" : "unprotected-preview",
    createdAt: "2026-08-15T12:00:00.000Z",
    expiresAt: "2026-08-15T12:10:00.000Z",
    sourceFingerprint: "fingerprint",
    selectedDifficulties: 1,
    affectedDifficulties: protectedMode ? 3 : 8,
    affectedSets: protectedMode ? 1 : 3,
    logicalBytes: 1024,
    uniqueBackupBytes: 4096,
    protectedSets: 0,
    playedSetsSkipped: protectedMode ? 2 : 0,
    playedDifficultiesSkipped: protectedMode ? 5 : 0,
    examples: [],
    blockers: [],
    confirmationPhrase: protectedMode ? "DELETE 1 SET" : "DELETE 3 SETS",
    canExecute: true,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("protected deletion review", () => {
  it("protects played sets by default and invalidates the preview when disabled", async () => {
    vi.stubGlobal("React", React);
    const previewDeletion = vi.fn(
      (
        _query: typeof DEFAULT_QUERY,
        _selection: SerializableSelection,
        policy: DeletionPolicy,
      ) => Promise.resolve(previewFor(policy)),
    );
    Object.defineProperty(window, "libraryManager", {
      configurable: true,
      value: { previewDeletion },
    });

    render(
      React.createElement(ProtectedDeletionModal, {
        filterLabels: ["Never played"],
        onClose: vi.fn(),
        onMutation: vi.fn(),
        open: true,
        query: DEFAULT_QUERY,
        selection,
      }),
    );

    const protection = screen.getByRole("checkbox", {
      name: /protect sets with any recorded play/i,
    });
    expect(protection.checked).toBe(true);
    await screen.findByText("2 played sets protected");
    expect(
      screen.getByText(/5 whole-set difficulties were excluded/i),
    ).toBeTruthy();
    expect(previewDeletion).toHaveBeenCalledWith(DEFAULT_QUERY, selection, {
      protectPlayedSets: true,
    });

    const confirmation = screen.getByPlaceholderText("DELETE 1 SET");
    fireEvent.change(confirmation, { target: { value: "DELETE 1 SET" } });
    expect(confirmation.value).toBe("DELETE 1 SET");

    fireEvent.click(protection);

    await screen.findByText("Whole-set play protection is off");
    await waitFor(() =>
      expect(previewDeletion).toHaveBeenLastCalledWith(
        DEFAULT_QUERY,
        selection,
        { protectPlayedSets: false },
      ),
    );
    const refreshedConfirmation = screen.getByPlaceholderText("DELETE 3 SETS");
    expect(refreshedConfirmation.value).toBe("");
  });
});
