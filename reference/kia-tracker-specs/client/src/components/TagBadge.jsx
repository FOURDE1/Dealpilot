import { X } from 'lucide-react';

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return `rgba(59, 130, 246, ${alpha})`;
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function TagBadge({ tag, size = 'sm', onRemove }) {
  if (!tag) return null;
  const color = tag.color || '#3B82F6';
  const isSm = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        isSm ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
      }`}
      style={{
        backgroundColor: hexToRgba(color, 0.12),
        color,
        border: `1px solid ${hexToRgba(color, 0.35)}`,
      }}
    >
      <span className="truncate max-w-[120px]">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(tag);
          }}
          className="hover:opacity-70"
          aria-label={`Remove tag ${tag.name}`}
        >
          <X size={isSm ? 10 : 12} />
        </button>
      )}
    </span>
  );
}
