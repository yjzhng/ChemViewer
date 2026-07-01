/** IndexedDB persistence for saved subsets (filter shortcuts). */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Subset } from './types';

interface ChemViewerDB extends DBSchema {
  subsets: {
    key: string;
    value: Subset;
    indexes: { byLibrary: string };
  };
}

let dbPromise: Promise<IDBPDatabase<ChemViewerDB>> | null = null;

function db(): Promise<IDBPDatabase<ChemViewerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ChemViewerDB>('chemviewer', 1, {
      upgrade(database) {
        const store = database.createObjectStore('subsets', { keyPath: 'id' });
        store.createIndex('byLibrary', 'libraryId');
      },
    });
  }
  return dbPromise;
}

export async function getAllSubsets(): Promise<Subset[]> {
  return (await db()).getAll('subsets');
}

export async function putSubset(subset: Subset): Promise<void> {
  await (await db()).put('subsets', subset);
}

export async function deleteSubset(id: string): Promise<void> {
  await (await db()).delete('subsets', id);
}
