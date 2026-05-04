import { useEffect, useRef, useMemo, useCallback } from "react";
import Uplot from "uplot";
import "uplot/dist/uPlot.min.css";

type DataPoint = {
  timestamp: number;
  mean: number | null;
  std?: number | null;
};

interface Props {
  data: DataPoint[];
  frequency: string;
  height?: number;
  onZoomChange?: (startMs: number, endMs: number) => void;
}

export default function SeaLevelUPlot({
  data,
  frequency,
  height = 480,
  onZoomChange,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<Uplot | null>(null);

  const chartData = useMemo(() => {
    const t: (number | null)[] = [];
    const m: (number | null)[] = [];
    const p: (number | null)[] = [];
    const n: (number | null)[] = [];

    data.forEach((d) => {
      t.push(d.timestamp ? d.timestamp / 1000 : null);
      m.push(d.mean);
      if (d.std != null && d.mean != null) {
        p.push(d.mean + d.std);
        n.push(d.mean - d.std);
      } else {
        p.push(null);
        n.push(null);
      }
    });

    const nullCount = m.filter((x) => x === null).length;
    console.log("[SeaLevelUPlot] points:", m.length, "nulls:", nullCount);

    return { time: t, mean: m, plusStd: p, minusStd: n };
  }, [data]);

  const zoomIn = useCallback(() => {
    if (!uplotRef.current) return;
    const u = uplotRef.current;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    if (min == null || max == null) return;

    const range = max - min;
    const center = min + range / 2;
    const newRange = range * 0.7;
    u.setScale("x", { min: center - newRange / 2, max: center + newRange / 2 });
  }, []);

  const zoomOut = useCallback(() => {
    if (!uplotRef.current) return;
    const u = uplotRef.current;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    if (min == null || max == null) return;

    const range = max - min;
    const center = min + range / 2;
    const newRange = range * 1.4;
    const dataMin = chartData.time[0] ?? 0;
    const dataMax = chartData.time[chartData.time.length - 1] ?? 0;
    const clampedRange = Math.min(newRange, dataMax - dataMin);
    u.setScale("x", {
      min: center - clampedRange / 2,
      max: center + clampedRange / 2,
    });
  }, [chartData.time]);

  const panLeft = useCallback(() => {
    if (!uplotRef.current) return;
    const u = uplotRef.current;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    if (min == null || max == null) return;

    const range = max - min;
    const shift = range * 0.2;
    const dataMin = chartData.time[0] ?? 0;
    // const dataMax = chartData.time[chartData.time.length - 1] ?? 0;
    const newMin = Math.max(dataMin, min - shift);
    const newMax = Math.max(dataMin + range, newMin + range);
    u.setScale("x", { min: newMin, max: newMax });
  }, [chartData.time]);

  const panRight = useCallback(() => {
    if (!uplotRef.current) return;
    const u = uplotRef.current;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    if (min == null || max == null) return;

    const range = max - min;
    const shift = range * 0.2;
    // const dataMin = chartData.time[0] ?? 0;
    const dataMax = chartData.time[chartData.time.length - 1] ?? 0;
    const newMax = Math.min(dataMax, max + shift);
    const newMin = Math.min(dataMax - range, newMax - range);
    u.setScale("x", { min: newMin, max: newMax });
  }, [chartData.time]);

  const resetZoom = useCallback(() => {
    if (!uplotRef.current || chartData.time.length === 0) return;
    const min = chartData.time[0] ?? 0;
    const max = chartData.time[chartData.time.length - 1] ?? 0;
    uplotRef.current.setScale("x", { min, max });
  }, [chartData.time]);

  useEffect(() => {
    if (!chartRef.current || chartData.time.length === 0) return;

    if (uplotRef.current) uplotRef.current.destroy();

    const isHighRes = frequency === "10min" || frequency === "hour";

    const opts: Uplot.Options = {
      width: chartRef.current.offsetWidth,
      height: height,
      padding: [20, 24, 50, 70],

      scales: { x: { time: true }, y: { auto: true } },

      series: [
        {
          label: "Время",
          value: (_u, v) =>
            v ? new Date(v * 1000).toLocaleString("ru-RU") : "",
        },
        { label: "Среднее", stroke: "#006994", width: 2.8, spanGaps: false },
        {
          label: "+1σ",
          stroke: "#ff7f0e",
          width: 1.5,
          dash: [5, 3],
          spanGaps: false,
        },
        {
          label: "-1σ",
          stroke: "#ff7f0e",
          width: 1.5,
          dash: [5, 3],
          spanGaps: false,
        },
      ],

      axes: [
        {
          scale: "x",
          grid: { stroke: "#e5e5e5" },
          ticks: { stroke: "#999" },
          splits: (u: Uplot) => {
            const maxTicks = 11;
            const min = u.scales.x.min ?? 0;
            const max = u.scales.x.max ?? 0;

            const visibleData = chartData.time.filter(
              (t): t is number => t !== null && t >= min && t <= max,
            );

            if (visibleData.length <= maxTicks) {
              return visibleData;
            }

            const range = max - min;
            if (range === 0) return [];

            const step = range / (maxTicks - 1);
            const splits: number[] = [];
            for (let i = 0; i < maxTicks; i++) {
              splits.push(min + i * step);
            }
            return splits;
          },
          values: (_u, vals) => {
            return vals
              .filter((v): v is number => v !== null)
              .map((v) => formatDate(v * 1000, isHighRes));
          },
        },
        { scale: "y", grid: { stroke: "#e5e5e5" }, ticks: { stroke: "#999" } },
      ],

      cursor: { drag: { x: true, y: false }, points: { show: false } },
      legend: { show: true },
    };

    uplotRef.current = new Uplot(
      opts,
      [
        chartData.time,
        chartData.mean,
        chartData.plusStd,
        chartData.minusStd,
      ] as any,
      chartRef.current,
    );

    // Перехват изменения зума
    const onSetScale = (u: Uplot, scaleKey: string) => {
      if (scaleKey === "x" && onZoomChange) {
        const min = u.scales.x.min;
        const max = u.scales.x.max;
        if (min != null && max != null) {
          onZoomChange(min * 1000, max * 1000);
        }
      }
    };

    uplotRef.current.hooks.setScale?.push(onSetScale);

    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [chartData, height, frequency, onZoomChange]);

  const formatDate = (timestampMs: number, isHighRes: boolean): string => {
    const d = new Date(timestampMs);
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const year = (d.getFullYear() % 100).toString().padStart(2, "0");

    if (isHighRes) {
      const hours = d.getHours().toString().padStart(2, "0");
      const minutes = d.getMinutes().toString().padStart(2, "0");
      return `${day}.${month}.${year} ${hours}:${minutes}`;
    }
    return `${day}.${month}.${year}`;
  };

  return (
    <div>
      <div
        style={{
          textAlign: "right",
          marginBottom: "6px",
          display: "flex",
          gap: "4px",
          justifyContent: "flex-end",
        }}
      >
        <button onClick={panLeft} style={{ padding: "4px 8px" }}>
          ←
        </button>
        <button onClick={zoomOut} style={{ padding: "4px 10px" }}>
          −
        </button>
        <button onClick={zoomIn} style={{ padding: "4px 10px" }}>
          +
        </button>
        <button onClick={panRight} style={{ padding: "4px 8px" }}>
          →
        </button>
        <button onClick={resetZoom} style={{ padding: "4px 10px" }}>
          Сброс
        </button>
      </div>
      <div ref={chartRef} style={{ width: "100%", minHeight: height }} />
    </div>
  );
}
