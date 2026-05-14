import React, { memo } from "react";

interface ImportFile {
  filename: string;
  status: string;
  records_count: number;
}

interface Props {
  isOpen: boolean;
  files: ImportFile[];
  onClose: () => void;
}

const FilesModal = memo(({ isOpen, files, onClose }: Props) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Загруженные файлы</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {files.length === 0 ? (
            <p>Нет загруженных файлов</p>
          ) : (
            <table className="files-table">
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Статус</th>
                  <th>Записей</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.filename}>
                    <td>{f.filename}</td>
                    <td className={f.status}>{f.status}</td>
                    <td>{f.records_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
});

FilesModal.displayName = "FilesModal";

export default FilesModal;
