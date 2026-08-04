import { useStore, type AppPage } from '../data/store';
import { useUpdateCheck } from '../useUpdateCheck';

const PAGES: { id: AppPage; label: string }[] = [
  { id: 'manage', label: 'Manage' },
  { id: 'browse', label: 'Library' },
  { id: 'analyse', label: 'Analyse' },
  { id: 'search', label: 'Search' },
];

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppNav() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const silenced = useStore((s) => s.updateSilenced);
  const update = useUpdateCheck();
  const showUpdateDot = update.updateAvailable && !silenced;

  return (
    <nav className="appnav">
      <span className="brand">ChemViewer</span>

      <div className="pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`page-tab${page === p.id ? ' active' : ''}`}
            onClick={() => setPage(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <span className="spacer" />

      <button
        className="icon-btn update-anchor"
        title={
          showUpdateDot ? `Settings — v${update.latest} available` : 'Settings'
        }
        aria-label={
          showUpdateDot ? 'Settings (update available)' : 'Settings'
        }
        onClick={() => setSettingsOpen(true)}
      >
        <GearIcon />
        {showUpdateDot && <span className="update-dot" aria-hidden="true" />}
      </button>
    </nav>
  );
}
