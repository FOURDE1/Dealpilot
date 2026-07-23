export default function SectionCard({ title, icon: Icon, children, right, accent = 'teal' }) {
  const grad = accent === 'teal'
    ? 'from-teal-600 to-emerald-700'
    : accent === 'slate'
    ? 'from-slate-700 to-slate-800'
    : 'from-teal-600 to-emerald-700';
  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-4">
      <header className={`bg-gradient-to-r ${grad} text-white px-4 py-2.5 flex items-center justify-between`}>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          {Icon && <Icon size={16} />} {title}
        </h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export function MoneyInput({ value, onChange, placeholder = '0.00', disabled = false }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value ?? 0}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        placeholder={placeholder}
        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-100"
      />
    </div>
  );
}

export function NumberInput({ value, onChange, step = 1, min = 0, max, suffix, placeholder }) {
  return (
    <div className="relative">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${suffix ? 'pr-8' : ''}`}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{suffix}</span>}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
    />
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-teal-600' : 'bg-gray-300'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </span>
      {label && <span className="text-xs text-gray-600">{label}</span>}
    </label>
  );
}
