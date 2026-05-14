import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "./store";
import {
  importFiles as importFilesApi,
  aggregate,
  exportFullData,
  exportMonthData,
  getAvailableYears,
  getImportLog,
  getDateRange,
  clearAggregateCache,
} from "./api";
import ChartSection from "./components/ChartSection";
import ControlsSection from "./components/ControlsSection";
import FilesModal from "./components/FilesModal";
import ActionButtonsSection from "./components/ActionButtonsSection";

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
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportFilename, setExportFilename] = useState<string | null>(null);
  const [showMonthExportModal, setShowMonthExportModal] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(1);
  const [availableYears, setAvailableYears] = useState<number[]>([]);

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
      setIsLoadingOverlay(true);
      
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
    } finally {
      setIsLoadingOverlay(false);
    }
  };

  // Обновляет диапазон дат после импорта (выравнивание на начало/конец периода)
  // Возвращает новые startDate и endDate для последующего расчёта
  const updateDateRangeAfterImport = async (): Promise<{ startDate: string; endDate: string } | null> => {
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

        const newStartDate = start.toISOString().split("T")[0];
        const newEndDate = end.toISOString().split("T")[0];
        
        setStartDate(newStartDate);
        setEndDate(newEndDate);
        setSelectedPeriod(0);
        
        return { startDate: newStartDate, endDate: newEndDate };
      }
      return null;
    } catch (e) {
      console.error("Failed to update date range:", e);
      return null;
    } finally {
      setIsLoadingOverlay(false);
    }
  };

  const handleImport = useCallback(async () => {
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

      // Задержка после закрытия диалога — fix для Windows (event loop recovery)
      await new Promise(r => setTimeout(r, 100));

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

        const range = await updateDateRangeAfterImport();
        
        // Очистка кэша агрегации после импорта (dev-режим)
        await clearAggregateCache();
        
        setAggregateData([]);
        setCalcTime(0);
        
        // Автоматический пересчёт после импорта
        if (range) {
          await performCalculate(range.startDate, range.endDate, frequency);
        }
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
  }, [useIqrFilter, setError, setAggregateData, setCalcTime, frequency, clearAggregateCache]);

  const performCalculate = async (sDate: string, eDate: string, freq: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const startTime = Date.now();

      const result = await aggregate(sDate, eDate, freq);
      setAggregateData(result.data);
      setCalcTime(Date.now() - startTime);
    } catch (e: any) {
      setError(e?.message || "Ошибка расчёта");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalculate = useCallback(async () => {
    if (!startDate || !endDate) {
      setError("Выберите диапазон дат");
      return;
    }
    await performCalculate(startDate, endDate, frequency);
  }, [startDate, endDate, frequency, setError]);

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

  const handleExportFullCSV = useCallback(async () => {
    try {
      setIsLoadingOverlay(true);
      setExportMessage(null);
      
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
      const filename = `sealevel_${frequency}_full_${startDate}_${endDate}.csv`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
      setExportFilename(filename);
      setExportMessage("Файл сохранён!");
      setTimeout(() => {
        setExportMessage(null);
        setExportFilename(null);
      }, 5000);
    } catch (e: any) {
      setError(e?.message || "Ошибка экспорта");
    } finally {
      setIsLoadingOverlay(false);
    }
  }, [startDate, endDate, frequency, setError]);

  const handleMonthExport = async () => {
    if (!selectedYear) {
      setError("Выберите год");
      return;
    }

    try {
      setIsLoadingOverlay(true);
      const filename = await exportMonthData(selectedYear, selectedMonth);
      
      setExportFilename(filename);
      setExportMessage("Файл месяца сохранён!");
      setTimeout(() => {
        setExportMessage(null);
        setExportFilename(null);
      }, 5000);
      setShowMonthExportModal(false);
    } catch (e: any) {
      setError(e?.message || "Ошибка экспорта месяца");
    } finally {
      setIsLoadingOverlay(false);
    }
  };

  const openMonthExportModal = async () => {
    try {
      const years = await getAvailableYears();
      setAvailableYears(years);
      if (years.length > 0) {
        setSelectedYear(years[0]);
      }
      setShowMonthExportModal(true);
    } catch (e) {
      setError("Не удалось загрузить список лет");
    }
  };

  // Быстрый зум
  const setQuickPeriod = useCallback((days: number) => {
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
  }, [dateRange]);

  return (
    <div className="app">
      <header className="header">
        <h1>SeaLevel</h1>
        <span className="subtitle">Анализ данных уровня моря</span>
      </header>

      <div className="controls">
        <ActionButtonsSection
          onFilesClick={() => setShowFilesModal(true)}
          onImportClick={handleImport}
          onFilterToggle={setUseIqrFilter}
          onExportFullClick={handleExportFullCSV}
          onExportMonthClick={openMonthExportModal}
          filesCount={importFiles.length}
          isImporting={isImporting}
          isUiLocked={isUiLocked}
          useIqrFilter={useIqrFilter}
          hasAggregateData={aggregateData.length > 0}
        />

        <ControlsSection
          startDate={startDate}
          endDate={endDate}
          frequency={frequency}
          dateRange={dateRange}
          selectedPeriod={selectedPeriod}
          isLoading={isLoading}
          isUiLocked={isUiLocked}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onFrequencyChange={setFrequency}
          onLoadData={handleCalculate}
          onQuickPeriod={setQuickPeriod}
        />


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

      {exportMessage && (
        <div className="export-success">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{exportMessage} <strong>{exportFilename}</strong></span>
        </div>
      )}

      <div className="chart-container">
        <div className="chart">
          <ChartSection
            aggregateData={aggregateData}
            frequency={frequency}
            isLoading={isLoading}
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
        <FilesModal
          isOpen={showFilesModal}
          files={importFiles}
          onClose={() => setShowFilesModal(false)}
        />
      )}

      {showMonthExportModal && (
        <div className="modal-overlay" onClick={() => setShowMonthExportModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "400px" }}>
            <div className="modal-header">
              <h3>Экспорт месяца</h3>
              <button onClick={() => setShowMonthExportModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="control-group">
                <label>Год:</label>
                <select
                  value={selectedYear || ""}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  disabled={!availableYears.length}
                >
                  {availableYears.length === 0 ? (
                    <option>Нет данных</option>
                  ) : (
                    availableYears.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="control-group">
                <label>Месяц:</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <option key={month} value={month}>
                      {month === 1 && "Январь"}
                      {month === 2 && "Февраль"}
                      {month === 3 && "Март"}
                      {month === 4 && "Апрель"}
                      {month === 5 && "Май"}
                      {month === 6 && "Июнь"}
                      {month === 7 && "Июль"}
                      {month === 8 && "Август"}
                      {month === 9 && "Сентябрь"}
                      {month === 10 && "Октябрь"}
                      {month === 11 && "Ноябрь"}
                      {month === 12 && "Декабрь"}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button
                  className="btn btn-primary"
                  onClick={handleMonthExport}
                  disabled={!selectedYear || isUiLocked}
                  style={{ flex: 1 }}
                >
                  Экспорт
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowMonthExportModal(false)}
                  style={{ flex: 1 }}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
