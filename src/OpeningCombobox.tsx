import { useEffect, useId, useRef, useState } from 'react';

interface Option { id: string; label: string; count?: number }

export function OpeningCombobox({ label, options, selected, placeholder, disabled, onChange }: {
  label: string; options: Option[]; selected: string; placeholder: string;
  disabled: boolean; onChange: (id: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const chosen = options.find(option => option.id === selected);
  const matches = [{ id: '', label: placeholder }, ...options].filter(option =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const expanded = open && !disabled;
  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  const choose = (value: string) => { onChange(value); close(); input.current?.focus(); };

  useEffect(() => {
    if (!expanded) return;
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [expanded, active, id, query]);

  return <div className="field opening-combobox" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="opening-combobox-input">
      <input id={id} ref={input} role="combobox" autoComplete="off" disabled={disabled}
        aria-expanded={expanded} aria-controls={`${id}-options`} aria-autocomplete="list"
        aria-activedescendant={expanded && matches[active] ? `${id}-${active}` : undefined}
        value={open ? query : chosen?.label ?? ''} placeholder={chosen?.label ?? placeholder}
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive(index => !expanded ? 0 : Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter' && expanded) { event.preventDefault(); if (matches[active]) choose(matches[active].id); }
          if (event.key === 'Escape') { event.preventDefault(); close(); }
        }} />
      <button type="button" aria-label={`Show ${label.toLowerCase()} options`} disabled={disabled}
        aria-expanded={expanded} aria-controls={`${id}-options`}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { if (expanded) close(); else { input.current?.focus(); setOpen(true); } }}>▾</button>
    </div>
    {expanded && <div id={`${id}-options`} role="listbox" aria-label={label} className="opening-combobox-options">
      {matches.map((option, index) => <button type="button" role="option" tabIndex={-1} key={option.id} id={`${id}-${index}`}
        aria-selected={selected === option.id} className={index === active ? 'active' : ''}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option.id)}>
        <span>{option.label}</span>{option.count !== undefined && <small>{option.count.toLocaleString()}</small>}
      </button>)}
      {!matches.length && <p role="status">No matching openings.</p>}
    </div>}
  </div>;
}
