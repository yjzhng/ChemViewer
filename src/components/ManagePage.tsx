import { useState } from 'react';
import { LibraryManager } from './LibraryManager';
import { LibraryAuthor } from './LibraryAuthor';

/**
 * Top-level Manage page: the library folder manager, plus a "Create library"
 * button that swaps in the authoring/merge view. Creating a library navigates
 * to the Library page (so this returns to the manager next time it's opened).
 */
export function ManagePage() {
  const [creating, setCreating] = useState(false);

  return (
    <div className="page">
      <header className="browse-header">
        {creating ? (
          <>
            <button className="back-btn" onClick={() => setCreating(false)}>
              ← Back
            </button>
            <strong className="manage-title">Create library</strong>
          </>
        ) : (
          <>
            <strong className="manage-title">Manage libraries</strong>
            <span className="spacer" />
            <button className="primary" onClick={() => setCreating(true)}>
              + Create library
            </button>
          </>
        )}
      </header>

      {creating ? <LibraryAuthor /> : <LibraryManager />}
    </div>
  );
}
