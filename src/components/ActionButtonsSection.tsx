import React, { memo, useCallback } from "react";

interface Props {
  onFilesClick: () => void;
  onImportClick: () => void;
  onFilterToggle: (checked: boolean) => void;
  onExportFullClick: () => void;
  onExportMonthClick: () => void;
  filesCount: number;
  isImporting: boolean;
  isUiLocked: boolean;
  useIqrFilter: boolean;
  hasAggregateData: boolean;
}

const ActionButtonsSection = memo(({
  onFilesClick,
  onImportClick,
  onFilterToggle,
  onExportFullClick,
  onExportMonthClick,
  filesCount,
  isImporting,
  isUiLocked,
  useIqrFilter,
  hasAggregateData,
}: Props) => {
  return (
    <>
      <div className="control-group">
        <div className="files-list">
          <button
            className="btn-link"
            onClick={onFilesClick}
            disabled={isUiLocked}
          >
            Файлы ({filesCount})
          </button>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            className="btn btn-primary"
            onClick={onImportClick}
            disabled={isImporting}
          >
            {isImporting ? "Загрузка..." : "Загрузить"}
          </button>

          <button 
            className={`btn btn-funnel ${useIqrFilter ? "active" : ""}`}
            onClick={() => onFilterToggle(!useIqrFilter)}
            disabled={isUiLocked}
            title={useIqrFilter ? "Фильтр IQR включён" : "Фильтр IQR выключён"}
            aria-label="Переключить фильтр IQR"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="control-group">
        <button
          className="btn btn-secondary  btn-offset"
          style={{
            height: "36px",
            minHeight: "36px",
            padding: "4px 12px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: "1",
          }}
          onClick={onExportFullClick}
          disabled={!hasAggregateData || isUiLocked}
          aria-label="Экспорт CSV"
          title="Экспорт CSV (сжатый)"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      <div className="control-group">
        <button
          className="btn btn-info  btn-offset"
          style={{
            height: "36px",
            minHeight: "36px",
            padding: "4px 12px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: "1",
          }}
          onClick={onExportMonthClick}
          disabled={isUiLocked}
          aria-label="Экспорт месяца"
          title="Экспорт месяца в формате YYYY_MM.dat"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>
    </>
  );
});

ActionButtonsSection.displayName = "ActionButtonsSection";

export default ActionButtonsSection;
