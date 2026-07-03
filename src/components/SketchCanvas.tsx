import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import type { Ketcher } from 'ketcher-core';
import 'ketcher-react/dist/index.css';

// Created once; instantiates the Indigo WASM worker on first use (browser only).
// Isolated in its own module so the heavy Ketcher bundle is code-split out of
// the Search page and only fetched when a canvas actually renders.
const structServiceProvider = new StandaloneStructServiceProvider();

export default function SketchCanvas({
  onInit,
  onError,
}: {
  onInit: (k: Ketcher) => void;
  onError?: (message: string) => void;
}) {
  return (
    <Editor
      staticResourcesUrl=""
      structServiceProvider={structServiceProvider}
      errorHandler={(m) => onError?.(String(m))}
      onInit={onInit}
    />
  );
}
