import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function PdfDropZone({ visible, loading, onFile, onClose }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-6 print:hidden"
          onClick={onClose}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={handleDrop}
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border-4 border-dashed border-teal-400 p-12 max-w-xl w-full text-center shadow-2xl"
          >
            {loading ? (
              <>
                <Loader2 className="mx-auto text-teal-600 animate-spin mb-4" size={48} />
                <div className="text-lg font-bold text-gray-900 mb-1">{t('desking.parsingPdf')}</div>
              </>
            ) : (
              <>
                <FileText className="mx-auto text-teal-600 mb-4" size={48} />
                <div className="text-lg font-bold text-gray-900 mb-1">{t('desking.dropPdfHere')}</div>
                <div className="text-sm text-gray-500 mb-5">or</div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleChange}
                  className="hidden"
                />
                <button
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold"
                >
                  <Upload size={16} /> Browse Files
                </button>
                <button
                  onClick={onClose}
                  className="block mx-auto mt-4 text-xs text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
