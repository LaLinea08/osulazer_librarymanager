import { useState } from "react";
import {
  Check,
  ChevronRight,
  Database,
  FolderSearch,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  AppBuildInfo,
  LibraryCandidate,
  LibraryStatus,
} from "../../../shared/contracts";

interface OnboardingProps {
  status: LibraryStatus;
  build: AppBuildInfo;
  onChoose: () => Promise<void>;
  onUseCandidate: (candidate: LibraryCandidate) => Promise<void>;
}

export function Onboarding({
  status,
  build,
  onChoose,
  onUseCandidate,
}: OnboardingProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidate = status.detectedCandidates.find(
    (item) => item.confidence === "high",
  );

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The library location could not be selected.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-glow glow-one" />
      <div className="onboarding-glow glow-two" />
      <section className="onboarding-card">
        <header className="onboarding-brand">
          <div className="brand-mark large">
            <span />
          </div>
          <div>
            <strong>osu!lazer Library Manager</strong>
            <span>
              {build.channel === "development"
                ? "Development build"
                : `Version ${build.version}`}
            </span>
          </div>
        </header>
        <div className="onboarding-content">
          <div className="onboarding-copy">
            <span className="eyebrow">
              <Sparkles size={14} /> First launch
            </span>
            <h1>Take control of your library. Safely.</h1>
            <p>
              Search, inspect, and organize tens of thousands of osu!lazer
              beatmaps from a fast local index. Protected deletion is isolated
              behind verified backups and explicit confirmation.
            </p>
            <ol className="onboarding-steps">
              <li className="active">
                <span>
                  <FolderSearch size={17} />
                </span>
                <div>
                  <strong>Locate osu!lazer</strong>
                  <small>Automatic detection or a folder you choose</small>
                </div>
              </li>
              <li>
                <span>
                  <Database size={17} />
                </span>
                <div>
                  <strong>Build a read-only index</strong>
                  <small>
                    A verified snapshot keeps the game data untouched
                  </small>
                </div>
              </li>
              <li>
                <span>
                  <Check size={17} />
                </span>
                <div>
                  <strong>Explore your library</strong>
                  <small>Filter, sort, inspect, and select at full speed</small>
                </div>
              </li>
            </ol>
          </div>
          <div className="onboarding-action-card">
            <div className="detection-icon">
              <FolderSearch size={27} />
            </div>
            <span className="eyebrow">Installation</span>
            <h2>{candidate ? "osu!lazer found" : "Choose your data folder"}</h2>
            {candidate ? (
              <>
                <div className="detected-path">
                  <span>Detected data root</span>
                  <code>{candidate.displayPath}</code>
                  <div>
                    <Check size={13} /> client.realm <Check size={13} /> files
                  </div>
                </div>
                <button
                  className="primary-button wide"
                  disabled={busy || status.osuIsRunning}
                  onClick={() => void run(() => onUseCandidate(candidate))}
                  type="button"
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      Use this library <ChevronRight size={17} />
                    </>
                  )}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void run(onChoose)}
                  type="button"
                >
                  Choose a different folder
                </button>
              </>
            ) : (
              <>
                <p>
                  Select the folder that contains both <code>client.realm</code>{" "}
                  and <code>files</code>.
                </p>
                <button
                  className="primary-button wide"
                  disabled={busy}
                  onClick={() => void run(onChoose)}
                  type="button"
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      Browse for osu!lazer <ChevronRight size={17} />
                    </>
                  )}
                </button>
              </>
            )}
            {status.osuIsRunning && (
              <div className="inline-warning">
                Close osu!lazer before creating the first safety snapshot.
              </div>
            )}
            {error && <div className="inline-error">{error}</div>}
            <div className="safety-note">
              <ShieldCheck size={18} />
              <div>
                <strong>Safety-first by design</strong>
                <span>
                  Indexing is read-only. Protected whole-set deletion is enabled
                  only after a verified scan, recovery backup, and explicit
                  confirmation.
                </span>
              </div>
            </div>
          </div>
        </div>
        <footer className="onboarding-footer">
          <span>
            Realm schema compatibility is checked before every fresh scan.
          </span>
          <span>
            {build.version} · {build.commit}
          </span>
        </footer>
      </section>
    </main>
  );
}
