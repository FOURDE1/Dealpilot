import { formatCurrency } from '../../utils/deskingCalculations';

// A single line on the financial worksheet. Either displays a computed amount
// or renders an inline editable money input. Supports credits (parentheses),
// subtotals, totals, sub-indent, and inline tags (e.g., "EXEMPT").
export default function WorksheetLine({
  label,
  amount,
  credit = false,         // show as ($x,xxx) — subtracted
  editable = false,
  onChange,
  strong = false,
  total = false,          // thicker top border, larger font
  subtotal = false,       // light gray top border
  indent = 0,
  prefix = '',            // e.g. "−" or "="
  tag,                    // inline JSX chip
  onClick,
  className = '',
}) {
  const display = typeof amount === 'number'
    ? (credit ? `(${formatCurrency(Math.abs(amount))})` : formatCurrency(amount))
    : amount;

  const border = total
    ? 'bg-gradient-to-r from-gray-900 to-gray-800 text-white px-4 py-3 -mx-6 my-2 rounded-lg shadow-md'
    : subtotal
    ? 'border-t border-gray-300 pt-1.5 mt-1'
    : '';

  const fontSize = total ? 'text-xl' : 'text-sm';
  const weight = total || strong ? 'font-bold' : 'font-medium';
  const color = total ? 'text-white' : credit ? 'text-red-600' : 'text-gray-900';

  return (
    <div
      className={`flex items-center ${border} ${fontSize} ${onClick ? 'cursor-pointer hover:bg-teal-50 -mx-2 px-2 rounded' : ''} ${className}`}
      style={{ paddingLeft: indent * 16 }}
      onClick={onClick}
    >
      <span className={`flex-1 flex items-center gap-2 ${total ? 'text-white/90 uppercase text-xs tracking-wider' : 'text-gray-600'}`}>
        {prefix && <span className={`w-3 text-center ${total ? 'text-white/60' : 'text-gray-400'}`}>{prefix}</span>}
        {label}
        {tag}
      </span>
      {editable ? (
        <div className="relative w-36">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount ?? 0}
            onChange={(e) => onChange?.(parseFloat(e.target.value) || 0)}
            className={`w-full pl-6 pr-2 py-1 text-right border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${fontSize} ${weight} tabular-nums`}
          />
        </div>
      ) : (
        <span className={`${weight} ${color} tabular-nums w-36 text-right`}>{display}</span>
      )}
    </div>
  );
}
