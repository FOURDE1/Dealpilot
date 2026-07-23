import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { User, UserPlus, MoreVertical, Phone, Mail, ExternalLink, X } from 'lucide-react';

function KebabMenu({ onChangeBuyer, onDetach, onAddCoBuyer, contactId, hasCoBuyer }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 text-sm">
          <button
            onClick={() => { setOpen(false); onChangeBuyer(); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
          >
            Change client
          </button>
          <button
            onClick={() => { setOpen(false); onDetach(); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600"
          >
            Detach
          </button>
          {!hasCoBuyer && (
            <button
              onClick={() => { setOpen(false); onAddCoBuyer(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
            >
              Add co-buyer
            </button>
          )}
          <Link
            to={`/contacts/${contactId}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700"
          >
            Open contact <ExternalLink size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

function PersonRow({ person, onDetach, isSecondary = false }) {
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unnamed';

  return (
    <div className={`flex items-start justify-between gap-3 ${isSecondary ? 'pt-3 mt-3 border-t border-gray-100' : ''}`}>
      <div className="flex items-start gap-3 min-w-0">
        <div className={`flex-shrink-0 rounded-full flex items-center justify-center ${isSecondary ? 'w-8 h-8 bg-gray-100' : 'w-10 h-10 bg-teal-50'}`}>
          <User size={isSecondary ? 14 : 18} className={isSecondary ? 'text-gray-500' : 'text-teal-600'} />
        </div>
        <div className="min-w-0">
          <p className={`font-medium truncate ${isSecondary ? 'text-sm text-gray-700' : 'text-sm text-gray-900'}`}>
            {name}
            {isSecondary && <span className="ml-2 text-xs font-normal text-gray-400">Co-buyer</span>}
          </p>
          {person.phone && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
              <Phone size={11} /> {person.phone}
            </p>
          )}
          {person.email && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5 truncate">
              <Mail size={11} /> {person.email}
            </p>
          )}
        </div>
      </div>
      {isSecondary && onDetach && (
        <button
          onClick={() => onDetach(person.id)}
          className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
          title="Detach co-buyer"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default function CustomerCard({
  dealId,
  onAttachClick,
  buyer,
  coBuyer,
  legacyCustomer,
  onDetach,
  onChangeBuyer,
  onAddCoBuyer,
  onConvertLegacy,
}) {
  if (!buyer && legacyCustomer) {
    return (
      <section className="bg-white rounded-xl shadow-sm border border-amber-200 bg-amber-50/50 p-4">
        <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">Legacy Customer</h2>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <User size={18} className="text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900">{legacyCustomer.name}</p>
            {legacyCustomer.phone && (
              <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                <Phone size={11} /> {legacyCustomer.phone}
              </p>
            )}
            {legacyCustomer.address && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{legacyCustomer.address}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (onConvertLegacy) onConvertLegacy(); }}
          className="mt-3 w-full px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-200 hover:bg-amber-300 rounded-lg transition-colors"
        >
          Convert to contact &amp; attach
        </button>
      </section>
    );
  }

  if (!buyer) {
    return (
      <section className="bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-200 p-4">
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
            <UserPlus size={22} className="text-gray-400" />
          </div>
          <button
            onClick={onAttachClick}
            disabled={!dealId}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Attach Client
          </button>
          <p className="mt-2 text-xs text-gray-400 max-w-[220px] leading-relaxed">
            Attach a client to enable email quote and proceed to next step.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</h2>
        <KebabMenu
          onChangeBuyer={onChangeBuyer}
          onDetach={() => onDetach(buyer.id)}
          onAddCoBuyer={onAddCoBuyer}
          contactId={buyer.contact_id}
          hasCoBuyer={!!coBuyer}
        />
      </div>
      <PersonRow person={buyer} />
      {coBuyer && (
        <PersonRow person={coBuyer} onDetach={onDetach} isSecondary />
      )}
    </section>
  );
}
