import { useState, useEffect } from "react";
import { useStore } from "./store";
import {
  importFiles as importFilesApi,
  aggregate,
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
    importProgress,
    setImportProgress,
    importStatus,
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

  const [calcTime, setCalcTime] = useState(0);

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

      setIsImporting(true);
      setImportProgress(0);
      setImportStatus("Открытие диалога...");

      selected = await dialogLib.open({
        multiple: true,
        filters: [{ name: "Data Files", extensions: ["dat"] }],
      });

      if (!selected) {
        setIsImporting(false);
        return;
      }

      const files = Array.isArray(selected) ? selected : [selected];
      if (files.length === 0) {
        setIsImporting(false);
        return;
      }

      setImportProgress(20);
      setImportStatus(`Выбрано файлов: ${files.length}`);

      const result = await importFilesApi(files);

      if (result.files_processed > 0) {
        const log = await getImportLog();
        setImportFiles(log);

        const range = await getDateRange();
        setDateRange(range);

        setImportStatus(`Готово! Записей: ${result.records_count}`);
      }

      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        setImportStatus("");
      }, 1500);
    } catch (e: any) {
      setError("Ошибка импорта: " + (e?.message || String(e)));
      setIsImporting(false);
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

  const handleExportCSV = () => {
    if (aggregateData.length === 0) return;

    const headers = ["datetime", "mean", "std", "min", "max", "count"];
    const rows = aggregateData.map((d) => [
      d.datetime,
      d.mean ?? "",
      d.std ?? "",
      d.min ?? "",
      d.max ?? "",
      d.count,
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sealevel_${frequency}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
  };

  return (
    <div className="app">
      <header className="header">
        <h1>SeaLevel</h1>
        <span className="subtitle">Анализ данных уровня моря</span>
      </header>

      <div className="controls">
        <div className="control-group">
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={isImporting}
          >
            {isImporting ? "Загрузка..." : "Загрузить файлы"}
          </button>

          {isImporting && (
            <div className="progress-section">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <div className="progress-text">{importStatus}</div>
            </div>
          )}

          <div className="files-list">
            <button
              className="btn-link"
              onClick={() => setShowFilesModal(true)}
            >
              Файлы ({importFiles.length})
            </button>
          </div>
        </div>

        <div className="control-group">
          <label>Диапазон дат:</label>
          <div className="date-range">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span>–</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="control-group">
          <div className="control-group">
            <label>Быстрый период:</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <button className="btn-period" onClick={() => setQuickPeriod(30)}>30 дней</button>
              <button className="btn-period" onClick={() => setQuickPeriod(90)}>3 месяца</button>
              <button className="btn-period" onClick={() => setQuickPeriod(365)}>1 год</button>
              <button className="btn-period" onClick={() => setQuickPeriod(0)}>Весь период</button>
            </div>
          </div>
        </div>

        <div className="control-group">
          <label>Дискретность:</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
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
          // style={{
          //   display: "flex",
          //   justifyContent: "space-between",
          //   alignItems: "center",
          //   width: "100%",
          // }}
        >
          <button
            className="btn btn-success"
            onClick={handleCalculate}
            disabled={isLoading}
          >
            {isLoading ? "Расчёт..." : "Рассчитать"}
          </button>
        </div>

        <div className="control-group">
          <button
            className="btn btn-secondary"
            onClick={handleExportCSV}
            disabled={aggregateData.length === 0}
          >
            Экспорт CSV
          </button>
        </div>

        {/* Кнопки быстрого зума */}
      </div>

      {error && (
        <div className="error">
          <button onClick={() => setError(null)}>✕</button>
          {error}
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
        <span>Разрывов: {aggregateData.filter(d => d.mean === null || d.mean === undefined).length}</span>
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
