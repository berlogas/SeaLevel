import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "./store";
import {
  importFiles as importFilesApi,
  aggregate,
  exportFullData,
  getImportLog,
  getDateRange,
} from "./api";
import SeaLevelUPlot from "./components/SeaLevelUPlot";

const FREQUENCIES = [
  { value: "10min", label: "10 минут" },
  { value: "hour", label: "Час" },
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "decade", label: "Декада" },
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
  { value: "year", label: "Год" },
];

function App() {
  const {
    setImportFiles,
    importFiles,
    isImporting,
    setIsImporting,
    // importProgress,
    setImportProgress,
    // importStatus,
    setImportStatus,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    frequency,
    setFrequency,
    aggregateData,
    setAggregateData,
    isLoading,
    setIsLoading,
    dateRange,
    setDateRange,
    error,
    setError,
    showFilesModal,
    setShowFilesModal,
  } = useStore();

  const [useIqrFilter, setUseIqrFilter] = useState(false);
  const [isUiLocked, setIsUiLocked] = useState(false);
  const [isLoadingOverlay, setIsLoadingOverlay] = useState(false);

  // Слушатель событий импорта
  useEffect(() => {
    const unlisten = listen<{ progress: number; status: string; finished?: boolean }>(
      "import-progress",
      (event) => {
        setImportProgress(event.payload.progress);
        setImportStatus(event.payload.status || "");
        if (event.payload.finished) {
          setIsImporting(false);
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const [calcTime, setCalcTime] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState(0); // 0 = весь период по умолчанию

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const log = await getImportLog();
      setImportFiles(log);

      const range = await getDateRange();
      setDateRange(range);

      if (range.start && !startDate) {
        const [d, m, y] = range.start.split(".");
        setStartDate(`${y}-${m}-${d}`);
      }
      if (range.end && !endDate) {
        const [d, m, y] = range.end.split(".");
        setEndDate(`${y}-${m}-${d}`);
      }
    } catch (e) {
      console.error("Failed to load initial data:", e);
    }
  };

  // Обновляет диапазон дат после импорта (выравнивание на начало/конец периода)
  const updateDateRangeAfterImport = async () => {
    try {
      setIsLoadingOverlay(true);
      
      const log = await getImportLog();
      setImportFiles(log);

      const range = await getDateRange();
      setDateRange(range);

      // Выравниваем на начало и конец периода (как кнопка "Весь период")
      if (range.start && range.end) {
        const [d, m, y] = range.end.split(".");
        const end = new Date(`${y}-${m}-${d}`);
        let start = new Date(end);

        if (range.start) {
          const [d, m, y] = range.start.split(".");
          start = new Date(`${y}-${m}-${d}`);
        }

        setStartDate(start.toISOString().split("T")[0]);
        setEndDate(end.toISOString().split("T")[0]);
        setSelectedPeriod(0);
      }
    } catch (e) {
      console.error("Failed to update date range:", e);
    } finally {
      setIsLoadingOverlay(false);
    }
  };

  const handleImport = async () => {
    try {
      let selected: any = null;
      let dialogLib: any = null;

      try {
        dialogLib = await import("@tauri-apps/plugin-dialog");
      } catch (e) {
        setError("Cannot load dialog: " + String(e));
        return;
      }

      selected = await dialogLib.open({
        multiple: true,
        filters: [{ name: "Data Files", extensions: ["dat"] }],
      });

      if (!selected) {
        return;
      }

      const files = Array.isArray(selected) ? selected : [selected];
      if (files.length === 0) {
        return;
      }

      setIsImporting(true);
      setIsUiLocked(true);
      setIsLoadingOverlay(true);
      setImportProgress(0);
      const filterText = useIqrFilter ? " (IQR k=3)" : "";
      setImportStatus(`Выбрано файлов: ${files.length}${filterText}`);

      try {
        await importFilesApi(
          files,
          500, 3.0,
          useIqrFilter
        );

        await updateDateRangeAfterImport();
      } finally {
        setIsImporting(false);
        setIsUiLocked(false);
        setIsLoadingOverlay(false);
      }

    } catch (e: any) {
      setError("Ошибка импорта: " + (e?.message || String(e)));
      setIsImporting(false);
      setIsUiLocked(false);
      setIsLoadingOverlay(false);
    }
  };

  const handleCalculate = async () => {
    if (!startDate || !endDate) {
      setError("Выберите диапазон дат");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const startTime = Date.now();

      const result = await aggregate(startDate, endDate, frequency);
      setAggregateData(result.data);
      setCalcTime(Date.now() - startTime);
    } catch (e: any) {
      setError(e?.message || "Ошибка расчёта");
    } finally {
      setIsLoading(false);
    }
  };

  // const handleExportCSV = () => {
  //   if (aggregateData.length === 0) return;

  //   const headers = ["datetime", "mean", "std", "min", "max", "count"];
  //   const rows = aggregateData.map((d) => [
  //     d.datetime,
  //     d.mean ?? "",
  //     d.std ?? "",
  //     d.min ?? "",
  //     d.max ?? "",
  //     d.count,
  //   ]);

  //   const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  //   const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  //   const url = URL.createObjectURL(blob);
  //   const a = document.createElement("a");
  //   a.href = url;
  //   a.download = `sealevel_${frequency}_${startDate}_${endDate}.csv`;
  //   a.click();
  //   URL.revokeObjectURL(url);
  // };

  const handleExportFullCSV = async () => {
    try {
      setIsLoading(true);
      const result = await exportFullData(startDate, endDate, frequency);
      const data = result.data;

      const headers = ["datetime", "mean", "std", "min", "max", "count"];
      const rows = data.map((d: any) => [
        d.datetime,
        d.mean ?? "",
        d.std ?? "",
        d.min ?? "",
        d.max ?? "",
        d.count,
      ]);

      const csv = [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sealevel_${frequency}_full_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Ошибка экспорта");
    } finally {
      setIsLoading(false);
    }
  };

  // Быстрый зум
  const setQuickPeriod = (days: number) => {
    if (!dateRange.end) return;

    const [d, m, y] = dateRange.end.split(".");
    const end = new Date(`${y}-${m}-${d}`);
    let start = new Date(end);

    if (days === 0) {
      // Весь период
      if (dateRange.start) {
        const [d, m, y] = dateRange.start.split(".");
        start = new Date(`${y}-${m}-${d}`);
      }
    } else {
      start = new Date(end);
      start.setDate(start.getDate() - days);
    }

    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
    setSelectedPeriod(days);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>SeaLevel</h1>
        <span className="subtitle">Анализ данных уровня моря</span>
      </header>

      <div className="controls">
        <div className="control-group">
          <div className="files-list">
            <button
              className="btn-link"
              onClick={() => setShowFilesModal(true)}
              disabled={isUiLocked}
            >
              Файлы ({importFiles.length})
            </button>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? "Загрузка..." : "Загрузить"}
            </button>

            {/* Чекбокс IQR фильтра */}
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: isUiLocked ? "not-allowed" : "pointer" }}>
              <input
                type="checkbox"
                checked={useIqrFilter}
                onChange={(e) => setUseIqrFilter(e.target.checked)}
                disabled={isUiLocked}
              />
              <span style={{ fontSize: "13px" }}>ФИЛЬТР</span>
            </label>
          </div>
        </div>

        <div className="control-group">
          <label>Диапазон дат:</label>
          <div className="date-range">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isUiLocked}
            />
            <span>–</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isUiLocked}
            />
          </div>
        </div>

        <div className="control-group">
          <label>Быстрый период:</label>
          <div style={{ display: "flex", gap: "6px" }}>
            <button 
              className="btn-period" 
              onClick={() => setQuickPeriod(30)}
              disabled={isUiLocked}
              style={{ backgroundColor: selectedPeriod === 30 ? '#e7f5ff' : undefined }}
            >
              30 дней
            </button>
            <button 
              className="btn-period" 
              onClick={() => setQuickPeriod(90)}
              disabled={isUiLocked}
              style={{ backgroundColor: selectedPeriod === 90 ? '#e7f5ff' : undefined }}
            >
              3 месяца
            </button>
            <button 
              className="btn-period" 
              onClick={() => setQuickPeriod(365)}
              disabled={isUiLocked}
              style={{ backgroundColor: selectedPeriod === 365 ? '#e7f5ff' : undefined }}
            >
              1 год
            </button>
            <button 
              className="btn-period" 
              onClick={() => setQuickPeriod(0)}
              disabled={isUiLocked}
              style={{ backgroundColor: selectedPeriod === 0 ? '#e7f5ff' : undefined }}
            >
              Весь период
            </button>
          </div>
        </div>

        <div className="control-group">
          <label>Дискретность:</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            disabled={isUiLocked}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div
          className="control-group"
        >
          <button
            className="btn btn-success  btn-offset"
            onClick={handleCalculate}
            disabled={isLoading || isUiLocked}
          >
            {isLoading ? "Расчёт..." : "Рассчитать"}
          </button>
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
            onClick={handleExportFullCSV}
            disabled={aggregateData.length === 0 || isUiLocked}
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
      </div>

      {error && (
        <div className="error">
          <button onClick={() => setError(null)}>✕</button>
          {error}
        </div>
      )}

      {isLoadingOverlay && (
        <div className="loading-overlay">
          <div className="spinner-large" />
          <p>Пожалуйста, подождите...</p>
        </div>
      )}

      <div className="chart-container">
        <div className="chart">
          <SeaLevelUPlot
            data={aggregateData}
            frequency={frequency}
            height={480}
          />
        </div>
      </div>

      <footer className="status-bar">
        <span>
          Диапазон: {dateRange.start || "–"} – {dateRange.end || "–"}
        </span>
        <span>Точек: {aggregateData.length}</span>
        <span>
          Разрывов:{" "}
          {
            aggregateData.filter((d) => d.mean === null || d.mean === undefined)
              .length
          }
        </span>
        <span>Время расчёта: {calcTime} мс</span>
      </footer>

      {showFilesModal && (
        <div className="modal-overlay" onClick={() => setShowFilesModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Загруженные файлы</h3>
              <button onClick={() => setShowFilesModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {importFiles.length === 0 ? (
                <p>Нет загруженных файлов</p>
              ) : (
                <table className="files-table">
                  <thead>
                    <tr>
                      <th>Файл</th>
                      <th>Статус</th>
                      <th>Записей</th>
                      <th>Дата импорта</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importFiles.map((f) => (
                      <tr key={f.filename}>
                        <td>{f.filename}</td>
                        <td className={f.status}>{f.status}</td>
                        <td>{f.records_count}</td>
                        <td>
                          {f.imported_at
                            ? new Date(f.imported_at).toLocaleString("ru-RU")
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
