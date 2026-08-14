import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Plus, X, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeArabic } from '../utils';

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  /** Allow committing a value that is not in `options` (shows an "Add …" row). */
  allowCreate?: boolean;
  /** Show the clear (×) button when a value is set. */
  clearable?: boolean;
  /** Sentinel that means "nothing selected" (e.g. 'None'); written back on clear. */
  emptyValue?: string;
  disabled?: boolean;
  /** Rendered above the panel list, e.g. "Departments". */
  listLabel?: string;
}

/**
 * Searchable select that can also create values. Replaces the native
 * <select> + <datalist> pairs, which could not create values (select) and
 * rendered a browser-styled, unsearchable list (datalist).
 *
 * The panel is portalled to <body> and positioned with fixed coordinates so it
 * is never clipped by a modal's own overflow.
 */
export default function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  allowCreate = true,
  clearable = true,
  emptyValue = '',
  disabled = false,
  listLabel,
}: ComboBoxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; drop: 'down' | 'up' }>({
    top: 0, left: 0, width: 0, drop: 'down',
  });

  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 'None' (or whatever the caller uses as a sentinel) reads as empty.
  const displayValue = value && value !== emptyValue ? value : '';

  const cleanOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of options) {
      const v = (o ?? '').trim();
      if (!v || v === 'Other...' || (emptyValue && v === emptyValue)) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }, [options, emptyValue]);

  const filtered = useMemo(() => {
    const q = normalizeArabic(query.trim());
    if (!q) return cleanOptions;
    const starts: string[] = [];
    const contains: string[] = [];
    for (const o of cleanOptions) {
      const n = normalizeArabic(o);
      if (n.startsWith(q)) starts.push(o);
      else if (n.includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [cleanOptions, query]);

  const typed = query.trim();
  const canCreate =
    allowCreate &&
    typed.length > 0 &&
    !cleanOptions.some(o => normalizeArabic(o) === normalizeArabic(typed));

  // Row 0..n-1 are options; the create row (when shown) is the last index.
  const rowCount = filtered.length + (canCreate ? 1 : 0);

  const measure = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const drop: 'down' | 'up' = spaceBelow < 240 && r.top > spaceBelow ? 'up' : 'down';
    setRect({
      top: drop === 'down' ? r.bottom + 4 : r.top - 4,
      left: r.left,
      width: r.width,
      drop,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onScrollOrResize = () => measure();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      commitAndClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  });

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-row="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const openPanel = () => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const select = (v: string) => {
    onChange(v);
    setQuery('');
    setOpen(false);
  };

  /** Closing without picking a row: free text still counts when creating is allowed. */
  const commitAndClose = () => {
    if (canCreate) onChange(typed);
    setQuery('');
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(emptyValue);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => (rowCount === 0 ? 0 : (h + 1) % rowCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => (rowCount === 0 ? 0 : (h - 1 + rowCount) % rowCount));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreate && highlight === rowCount - 1) select(typed);
      else if (filtered[highlight]) select(filtered[highlight]);
      else if (canCreate) select(typed);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setOpen(false);
    } else if (e.key === 'Tab') {
      commitAndClose();
    }
  };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '9px 12px',
    border: 'none', background: active ? 'var(--surface-3)' : 'transparent',
    color: 'var(--text-primary)', fontSize: 13, fontWeight: 500,
    textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <>
      <div ref={anchorRef} style={{ position: 'relative', width: '100%' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? commitAndClose() : openPanel())}
          onKeyDown={e => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
              e.preventDefault();
              openPanel();
            }
          }}
          className="input"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            textAlign: 'start', cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            borderColor: open ? 'var(--blue-500)' : undefined,
            boxShadow: open ? '0 0 0 3px rgba(59,130,246,0.12)' : undefined,
          }}
        >
          <span
            style={{
              flex: 1, minWidth: 0, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: displayValue ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {displayValue || placeholder || t('Select…')}
          </span>
          {clearable && displayValue && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t('Clear')}
              onClick={clear}
              style={{ display: 'flex', padding: 2, color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className="w-4 h-4"
            style={{
              flexShrink: 0, color: 'var(--text-muted)',
              transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
            }}
          />
        </button>
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: rect.drop === 'down' ? rect.top : undefined,
            bottom: rect.drop === 'up' ? window.innerHeight - rect.top : undefined,
            left: rect.left,
            width: rect.width,
            maxHeight: 280,
            display: 'flex', flexDirection: 'column',
            background: 'var(--surface)',
            border: '1.5px solid var(--blue-500)',
            borderRadius: 0,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            zIndex: 4000,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)', flexShrink: 0,
            }}
          >
            <Search className="w-3.5 h-3.5" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={allowCreate ? t('Search or type a new value…') : t('Search…')}
              style={{
                flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {listLabel && filtered.length > 0 && (
              <div
                style={{
                  padding: '7px 12px 4px', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)',
                }}
              >
                {listLabel}
              </div>
            )}

            {filtered.map((o, i) => {
              const isSelected = normalizeArabic(o) === normalizeArabic(displayValue);
              return (
                <button
                  key={o}
                  type="button"
                  data-row={i}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => select(o)}
                  style={rowStyle(highlight === i)}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o}
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5" style={{ flexShrink: 0, color: 'var(--accent)' }} />}
                </button>
              );
            })}

            {canCreate && (
              <button
                type="button"
                data-row={filtered.length}
                onMouseEnter={() => setHighlight(filtered.length)}
                onClick={() => select(typed)}
                style={{
                  ...rowStyle(highlight === filtered.length),
                  borderTop: filtered.length > 0 ? '1px solid var(--border)' : 'none',
                  color: 'var(--accent)', fontWeight: 600,
                }}
              >
                <Plus className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t('Add')} “{typed}”
                </span>
              </button>
            )}

            {filtered.length === 0 && !canCreate && (
              <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('No matches')}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
