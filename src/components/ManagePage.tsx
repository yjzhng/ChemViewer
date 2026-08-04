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
      {creating ? (
        <>
          <header className="browse-header">
            <button className="back-btn" onClick={() => setCreating(false)}>
              ← Back
            </button>
            <strong className="manage-title">Create library</strong>
          </header>
          <LibraryAuthor />
        </>
      ) : (
        <LibraryManager onCreate={() => setCreating(true)} />
      )}
    </div>
  );
}
