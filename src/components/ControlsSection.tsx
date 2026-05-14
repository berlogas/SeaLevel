import { memo } from "react";

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

interface Props {
  startDate: string;
  endDate: string;
  frequency: string;
  dateRange: { start: string | null; end: string | null };
  selectedPeriod: number;
  isLoading: boolean;
  isUiLocked: boolean;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onFrequencyChange: (freq: string) => void;
  onLoadData: () => void;
  onQuickPeriod: (days: number) => void;
}

const ControlsSection = memo(({
  startDate,
  endDate,
  frequency,
  dateRange,
  selectedPeriod,
  isLoading,
  isUiLocked,
  onStartDateChange,
  onEndDateChange,
  onFrequencyChange,
  onLoadData,
  onQuickPeriod,
}: Props) => {
  const hasDateRange = dateRange.start && dateRange.end;

  return (
    <>
      <div className="control-group">
        <label>Диапазон дат:</label>
        <div className="date-range">
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            min={hasDateRange ? (dateRange.start ?? undefined) : undefined}
            max={hasDateRange ? (dateRange.end ?? undefined) : undefined}
            disabled={isUiLocked}
          />
          <span>–</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            min={hasDateRange ? (dateRange.start ?? undefined) : undefined}
            max={hasDateRange ? (dateRange.end ?? undefined) : undefined}
            disabled={isUiLocked}
          />
        </div>
      </div>

      <div className="control-group">
        <label>Быстрый период:</label>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            className="btn-period"
            onClick={() => onQuickPeriod(30)}
            disabled={isUiLocked}
            style={{ backgroundColor: selectedPeriod === 30 ? "#e7f5ff" : undefined }}
          >
            30 дней
          </button>
          <button
            className="btn-period"
            onClick={() => onQuickPeriod(90)}
            disabled={isUiLocked}
            style={{ backgroundColor: selectedPeriod === 90 ? "#e7f5ff" : undefined }}
          >
            3 месяца
          </button>
          <button
            className="btn-period"
            onClick={() => onQuickPeriod(365)}
            disabled={isUiLocked}
            style={{ backgroundColor: selectedPeriod === 365 ? "#e7f5ff" : undefined }}
          >
            1 год
          </button>
          <button
            className="btn-period"
            onClick={() => onQuickPeriod(0)}
            disabled={isUiLocked}
            style={{ backgroundColor: selectedPeriod === 0 ? "#e7f5ff" : undefined }}
          >
            Весь период
          </button>
        </div>
      </div>

      <div className="control-group">
        <label>Дискретность:</label>
        <select
          value={frequency}
          onChange={(e) => onFrequencyChange(e.target.value)}
          disabled={isUiLocked}
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
          className="btn btn-success btn-offset"
          onClick={onLoadData}
          disabled={isLoading || isUiLocked}
        >
          {isLoading ? "Расчёт..." : "Рассчитать"}
        </button>
      </div>
    </>
  );
});

ControlsSection.displayName = "ControlsSection";

export default ControlsSection;
