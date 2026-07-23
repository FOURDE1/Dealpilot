import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function SlideOutPanel({ open, onClose, title, icon: Icon, children, width = 480, footer }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
          />
          <motion.aside
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="fixed top-0 right-0 h-full bg-white z-[61] shadow-2xl flex flex-col ring-1 ring-black/5"
            style={{ width: `min(${width}px, 100vw)` }}
          >
            <div className="h-1 bg-gradient-to-r from-red-600 via-red-500 to-red-400 shrink-0" />
            <header className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white shrink-0 shadow-sm">
              <h2 className="text-base font-bold flex items-center gap-2.5">
                {Icon && <span className="p-1.5 rounded-lg bg-white/15 backdrop-blur-sm"><Icon size={16} /></span>} {title}
              </h2>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="close">
                <X size={16} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
            <footer className="p-3 border-t border-gray-200 shrink-0 bg-gray-50 flex items-center justify-end gap-2">
              {footer}
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
              >
                {t('desking.done') || 'Done'}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
