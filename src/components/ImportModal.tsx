import React, { memo } from "react";

interface Props {
  isOpen: boolean;
  isImporting: boolean;
  importFiles: File[];
  useIqrFilter: boolean;
  onImportFilesChange: (files: File[]) => void;
  onFilterChange: (useFilter: boolean) => void;
  onImport: () => void;
  onClose: () => void;
}

const ImportModal = memo(({
  isOpen,
  isImporting,
  importFiles,
  useIqrFilter,
  onImportFilesChange,
  onFilterChange,
  onImport,
  onClose,
}: Props) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: 20,
          borderRadius: 8,
          minWidth: 400,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Импорт файлов</h2>

        <div style={{ marginBottom: 15 }}>
          <label>
            <input
              type="file"
              multiple
              accept=".txt,.csv,.dat"
              onChange={(e) => onImportFilesChange(Array.from(e.target.files || []))}
              disabled={isImporting}
            />
            {importFiles.length} файл(ов) выбрано
          </label>
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>
            <input
              type="checkbox"
              checked={useIqrFilter}
              onChange={(e) => onFilterChange(e.target.checked)}
              disabled={isImporting}
            />
            Удалять выбросы (IQR фильтр)
          </label>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onImport} disabled={isImporting || importFiles.length === 0}>
            {isImporting ? "Импортирование..." : "Импортировать"}
          </button>
          <button onClick={onClose} disabled={isImporting}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
});

ImportModal.displayName = "ImportModal";

export default ImportModal;
