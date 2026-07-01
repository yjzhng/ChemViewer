import { StructureCell } from './StructureCell';
import type { Compound, ColumnDef } from '../data/types';

interface Props {
  compound: Compound;
  columns: ColumnDef[];
  onClose: () => void;
}

export function MoleculeDialog({ compound, columns, onClose }: Props) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <strong>{compound.id}</strong>
          <button onClick={onClose}>Close</button>
        </div>

        <div className="struct-big">
          <StructureCell smiles={compound.smiles} width={360} height={240} />
        </div>

        <table className="props-table">
          <tbody>
            <tr>
              <td className="k">SMILES</td>
              <td className="mono-text" style={{ wordBreak: 'break-all' }}>
                {compound.smiles}
              </td>
            </tr>
            {columns.map((col) => {
              const v = compound.props[col.key];
              if (v == null || v === '') return null;
              return (
                <tr key={col.key}>
                  <td className="k">{col.label}</td>
                  <td>
                    {col.kind === 'url' ? (
                      <a href={String(v)} target="_blank" rel="noreferrer">
                        {String(v)}
                      </a>
                    ) : (
                      String(v)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
