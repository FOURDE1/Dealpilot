import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL;

export default function FileUpload({
  dealId,
  category,
  currentUrl,
  onUploadComplete,
  onDeleteComplete,
  disabled = false,
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/upload/${dealId}/${category}`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');

      const data = await res.json();
      onUploadComplete(data.url);
    } catch {
      setError(t('upload.failed'));
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleView = async () => {
    try {
      const res = await fetch(`${API_URL}/upload/${dealId}/${category}`);
      if (!res.ok) throw new Error('Failed to get file URL');
      const data = await res.json();
      window.open(data.url, '_blank', 'noopener');
    } catch {
      setError(t('upload.failed'));
    }
  };

  const handleRemove = async () => {
    try {
      const res = await fetch(`${API_URL}/upload/${dealId}/${category}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      onDeleteComplete();
    } catch {
      setError(t('upload.failed'));
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />

      {currentUrl ? (
        <>
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
          <span className="text-green-700 font-medium">{t('upload.uploaded')}</span>
          <button
            type="button"
            onClick={handleView}
            className="text-blue-600 hover:text-blue-800 underline text-xs"
            disabled={disabled}
          >
            {t('upload.view')}
          </button>
          {!disabled && (
            <button
              type="button"
              onClick={handleRemove}
              className="text-red-600 hover:text-red-800 underline text-xs"
            >
              {t('upload.remove')}
            </button>
          )}
        </>
      ) : (
        <>
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-red-700 font-medium">{t('upload.notUploaded')}</span>
          {!disabled && (
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={uploading}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? (
                <span className="flex items-center gap-1">
                  <svg
                    className="animate-spin h-3 w-3"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  {t('upload.uploading')}
                </span>
              ) : (
                t('upload.choose')
              )}
            </button>
          )}
        </>
      )}

      {error && <span className="text-red-500 text-xs">{error}</span>}
    </div>
  );
}
