import { useState } from 'react';
import { useStore, type Theme } from '../data/store';
import { ACCENT_PRESETS } from '../theme/accent';
import { pcClear } from '../data/precomputeCache';
import { Switch } from './Switch';

type Section = 'theme' | 'display' | 'data';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'theme', label: 'Theme' },
  { id: 'display', label: 'Chemical display' },
  { id: 'data', label: 'Data' },
];

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

function ThemeSection() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const accent = useStore((s) => s.accent);
  const setAccent = useStore((s) => s.setAccent);
  return (
    <>
      <div className="setting-row">
        <div className="setting-label">
          <div>Color theme</div>
          <div className="muted">Auto follows your operating system.</div>
        </div>
        <div className="segmented">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={theme === o.id ? 'active' : ''}
              onClick={() => setTheme(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div>Accent</div>
          <div className="muted">Highlights, toggles, and selection.</div>
        </div>
        <div className="swatches">
          <button
            className={`swatch-btn default-swatch${accent === null ? ' active' : ''}`}
            onClick={() => setAccent(null)}
          >
            Default
          </button>
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`swatch-btn${accent === p.hex ? ' active' : ''}`}
              style={{ background: p.hex }}
              title={p.label}
              onClick={() => setAccent(p.hex)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <div>{label}</div>
        {hint && <div className="muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.id}
          className={value === o.id ? 'active' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DisplaySection() {
  const draw = useStore((s) => s.draw);
  const setDraw = useStore((s) => s.setDraw);
  const structureScale = useStore((s) => s.structureScale);
  const setStructureScale = useStore((s) => s.setStructureScale);
  const palette = draw.atomPalette ?? 'element';
  const aromatic = draw.kekulize === false ? 'delocalized' : 'kekule';
  return (
    <>
      <div className="setting-row">
        <div className="setting-label">
          <div>Compactness</div>
          <div className="muted">
            Scale of in-table structures (lower = more compact rows).
          </div>
        </div>
        <div className="range-with-chip">
          <input
            type="range"
            className="plain-range"
            min={40}
            max={100}
            step={5}
            value={structureScale}
            onChange={(e) => setStructureScale(Number(e.target.value))}
          />
          <span className="level-chip">{structureScale}%</span>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div>Atom colours</div>
          <div className="muted">
            Element (CPK), or plain (carbon follows the theme).
          </div>
        </div>
        <Segmented
          value={palette}
          options={[
            { id: 'element', label: 'Element' },
            { id: 'plain', label: 'Plain' },
          ]}
          onChange={(v) => setDraw({ atomPalette: v })}
        />
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div>Aromatic rings</div>
          <div className="muted">Kekulé bonds or a delocalized ring.</div>
        </div>
        <Segmented
          value={aromatic}
          options={[
            { id: 'kekule', label: 'Kekulé' },
            { id: 'delocalized', label: 'Delocalized' },
          ]}
          onChange={(v) =>
            setDraw({ kekulize: v === 'delocalized' ? false : undefined })
          }
        />
      </div>

      <Toggle
        label="Stereo annotations"
        hint="Label R/S and E/Z centres."
        checked={!!draw.addStereoAnnotation}
        onChange={(v) => setDraw({ addStereoAnnotation: v })}
      />
      <Toggle
        label="Atom indices"
        hint="Number each atom."
        checked={!!draw.addAtomIndices}
        onChange={(v) => setDraw({ addAtomIndices: v })}
      />
      <Toggle
        label="Hand-drawn style"
        hint="Sketch-like (comic) rendering."
        checked={!!draw.comicMode}
        onChange={(v) => setDraw({ comicMode: v })}
      />
      <div className="setting-row">
        <div className="setting-label">
          <div>Bond thickness</div>
          <div className="muted">Line width of bonds.</div>
        </div>
        <div className="range-with-chip">
          <input
            type="range"
            className="plain-range"
            min={1}
            max={4}
            step={1}
            value={draw.bondLineWidth ?? 2}
            onChange={(e) => setDraw({ bondLineWidth: Number(e.target.value) })}
          />
          <span className="level-chip">{draw.bondLineWidth ?? 2}</span>
        </div>
      </div>
    </>
  );
}

function DataSection() {
  const [cleared, setCleared] = useState(false);
  return (
    <div className="setting-row">
      <div className="setting-label">
        <div>Precompute cache</div>
        <div className="muted">
          Similarity maps and PMI shapes are cached on disk and reused across
          sessions. Clear to recompute from scratch (e.g. after a data change).
        </div>
      </div>
      <button
        onClick={async () => {
          await pcClear();
          setCleared(true);
        }}
      >
        {cleared ? 'Cleared' : 'Clear cache'}
      </button>
    </div>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>('theme');

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-nav">
          <div className="settings-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-section${section === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </aside>

        <section className="settings-detail">
          <div className="settings-detail-head">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
            <button className="icon-btn" onClick={() => setSettingsOpen(false)}>
              Close
            </button>
          </div>
          {section === 'theme' && <ThemeSection />}
          {section === 'display' && <DisplaySection />}
          {section === 'data' && <DataSection />}
        </section>
      </div>
    </div>
  );
}
