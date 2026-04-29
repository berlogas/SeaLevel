import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  Legend,
} from "recharts";
import { useStore } from "./store";
import {
  importFiles as importFilesApi,
  aggregate,
  getImportLog,
  getDateRange,
} from "./api";

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
  const [chartDomain, setChartDomain] = useState<[number, number] | null>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const log = await getImportLog();
      setImportFiles(log);
      const range = await getDateRange();
      setDateRange(range);
      if (range.start) {
        const [d, m, y] = range.start.split(".");
        setStartDate(`${y}-${m}-${d}`);
      }
      if (range.end) {
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

      if (!dialogLib || typeof dialogLib.open !== "function") {
        setError("Dialog.open not found");
        return;
      }

      setIsImporting(true);
      setImportProgress(10);
      setImportStatus("Открытие диалога...");

      try {
        selected = await dialogLib.open({
          multiple: true,
          filters: [{ name: "Data Files", extensions: ["dat"] }],
        });
      } catch {
        setIsImporting(false);
        setImportProgress(0);
        setImportStatus("");
        setError("Диалог отменен");
        return;
      }

      if (!selected) {
        setIsImporting(false);
        setImportProgress(0);
        setImportStatus("");
        return;
      }

      const files = Array.isArray(selected) ? selected : [selected];
      if (files.length === 0) {
        setIsImporting(false);
        setImportProgress(0);
        setImportStatus("");
        return;
      }

      setImportProgress(20);
      setImportStatus(`Выбрано файлов: ${files.length}`);
      setError(null);

      try {
        setImportProgress(30);
        setImportStatus("Импорт... (может занять несколько минут)");

        const result = await importFilesApi(files);
        setImportProgress(90);

        if (result.files_processed > 0) {
          const log = await getImportLog();
          setImportFiles(log);

          const range = await getDateRange();
          setDateRange(range);
          if (range.start) {
            const [d, m, y] = range.start.split(".");
            setStartDate(`${y}-${m}-${d}`);
          }
          if (range.end) {
            const [d, m, y] = range.end.split(".");
            setEndDate(`${y}-${m}-${d}`);
          }

          setImportStatus(`Готово! Записей: ${result.records_count}`);
        } else {
          setError("Файлы не найдены или пустые");
        }

        setTimeout(() => {
          setIsImporting(false);
          setImportProgress(0);
          setImportStatus("");
        }, 2000);
      } catch (apiErr: any) {
        setImportProgress(0);
        setImportStatus("Ошибка");
        setError("Ошибка: " + (apiErr?.message || String(apiErr)));
        setIsImporting(false);
      }
    } catch (e: any) {
      setImportProgress(0);
      setImportStatus("");
      setError("Ошибка: " + (e?.message || String(e)));
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

      const startD = new Date(startDate);
      const endD = new Date(endDate);
      const startMonthStart = new Date(
        startD.getFullYear(),
        startD.getMonth(),
        1,
      );
      const endMonthEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 0);
      setChartDomain([startMonthStart.getTime(), endMonthEnd.getTime()]);

      const result = await aggregate(startDate, endDate, frequency);
      setAggregateData(result.data);
      setCalcTime(Date.now() - startTime);
    } catch (e: any) {
      setError(e?.message || e?.toString() || "Calculation failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (aggregateData.length === 0) return;

    const headers = ["datetime", "mean", "std", "min", "max", "count"];
    const rows = aggregateData.map((d) => [
      d.datetime,
      d.mean,
      d.std,
      d.min,
      d.max,
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
              <div className="progress-text">
                <span className="spinner"></span>
                {importStatus}
              </div>
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
            <div className="date-input-group">
              <input
                type="date"
                className="date-native"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <button
                type="button"
                className="date-btn"
                onClick={() => {
                  if (dateRange.start) {
                    const [d, m, y] = dateRange.start.split(".");
                    setStartDate(`${y}-${m}-${d}`);
                  }
                }}
                title="Минимум из данных"
              >
                ↓
              </button>
            </div>
            <span>–</span>
            <div className="date-input-group">
              <input
                type="date"
                className="date-native"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <button
                type="button"
                className="date-btn"
                onClick={() => {
                  if (dateRange.end) {
                    const [d, m, y] = dateRange.end.split(".");
                    setEndDate(`${y}-${m}-${d}`);
                  }
                }}
                title="Максимум из данных"
              >
                ↑
              </button>
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

        <div className="control-group">
          <button
            className="btn btn-success"
            onClick={handleCalculate}
            disabled={isLoading}
          >
            {isLoading ? "Расчёт..." : "Рассчитать"}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="error"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <button
            onClick={() => setError(null)}
            style={{
              padding: "4px 8px",
              background: "#721c24",
              color: "white",
              border: "none",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            X
          </button>
          {error}
        </div>
      )}

      <div className="chart-container">
        <div className="chart-header">
          <h2>График уровня моря</h2>
          <button
            className="btn btn-secondary"
            onClick={handleExportCSV}
            disabled={aggregateData.length === 0}
          >
            Экспорт CSV
          </button>
        </div>

        <div className="chart">
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart
              data={aggregateData}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="stdGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="3%" stopColor="#006994" stopOpacity={0.3} />
                  <stop offset="97%" stopColor="#006994" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />

              <XAxis
                type="number"
                dataKey="timestamp"
                domain={chartDomain || ["auto", "auto"]}
                tickCount={10}
                tickFormatter={(ts) => {
                  if (!ts) return "";
                  const d = new Date(ts);
                  if (frequency === "10min") {
                    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${(Math.floor(d.getMinutes() / 10) * 10).toString().padStart(2, "0")}`;
                  }
                  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${(d.getFullYear() % 100).toString().padStart(2, "0")}`;
                }}
                stroke="#666"
              />

              <YAxis stroke="#666" />

              <Tooltip
                labelFormatter={(ts) =>
                  ts ? new Date(ts).toLocaleDateString("ru-RU") : "Нет данных"
                }
                formatter={(value) => {
                  const num = typeof value === "number" ? value : Number(value);
                  return [isNaN(num) ? value : num.toFixed(2)];
                }}
              />

              <Legend />

              {/* 🔑 connectNulls={false} разрывает линию при пропусках данных */}
              <Area
                type="monotone"
                dataKey="mean"
                stroke="#006994"
                strokeWidth={2}
                fill="url(#stdGradient)"
                name="mean"
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey={(d) =>
                  d.mean !== null && d.std !== null ? d.mean + d.std : null
                }
                stroke="#ff7f0e"
                strokeWidth={1}
                strokeDasharray="4 4"
                name="+1σ"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey={(d) =>
                  d.mean !== null && d.std !== null ? d.mean - d.std : null
                }
                stroke="#ff7f0e"
                strokeWidth={1}
                strokeDasharray="4 4"
                name="-1σ"
                dot={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <footer className="status-bar">
        <span>
          Диапазон: {dateRange.start || "–"} – {dateRange.end || "–"}
        </span>
        <span>Точек: {aggregateData.length}</span>
        <span>Время расчёта: {calcTime} мс</span>
      </footer>

      {showFilesModal && (
        <div className="modal-overlay" onClick={() => setShowFilesModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Загруженные файлы</h3>
              <button
                className="modal-close"
                onClick={() => setShowFilesModal(false)}
              >
                ×
              </button>
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
                      <th>Дата</th>
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
