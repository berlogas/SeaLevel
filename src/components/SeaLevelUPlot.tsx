import { useEffect, useRef, useMemo, useState, useCallback } from "react";
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
}

export default function SeaLevelUPlot({
  data,
  frequency,
  height = 480,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<Uplot | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const chartData = useMemo(() => {
    const t: number[] = [];
    const m: (number | null)[] = [];
    const p: (number | null)[] = [];
    const n: (number | null)[] = [];

    data.forEach((d) => {
      if (d.mean === null) return; // пропускаем точки без среднего

      t.push(d.timestamp / 1000);
      m.push(d.mean);

      if (d.std != null && d.std > 0) {
        p.push(d.mean + d.std);
        n.push(d.mean - d.std);
      } else {
        p.push(null);
        n.push(null);
      }
    });

    return { time: t, mean: m, plusStd: p, minusStd: n };
  }, [data]);

  const resetZoom = useCallback(() => {
    uplotRef.current?.setScale("x", { min: null as any, max: null as any });
    setIsZoomed(false);
  }, []);

  const quickZoom = useCallback(
    (days: number) => {
      if (!uplotRef.current || chartData.time.length === 0) return;
      const latest = chartData.time[chartData.time.length - 1];
      const from = latest - days * 86400;
      uplotRef.current.setScale("x", { min: from, max: latest });
      setIsZoomed(true);
    },
    [chartData.time],
  );

  useEffect(() => {
    if (!chartRef.current || chartData.time.length === 0) return;

    if (uplotRef.current) uplotRef.current.destroy();

    const opts: Uplot.Options = {
      width: chartRef.current.offsetWidth,
      height: height,
      padding: [20, 24, 40, 70],

      scales: { x: { time: true }, y: { auto: true } },

      series: [
        {
          label: "Время",
          value: (_u, v) =>
            v ? new Date(v * 1000).toLocaleString("ru-RU") : "",
        },
        { label: "Среднее", stroke: "#006994", width: 2.8 },
        { label: "+1σ", stroke: "#ff7f0e", width: 1.5, dash: [5, 3] },
        { label: "-1σ", stroke: "#ff7f0e", width: 1.5, dash: [5, 3] },
      ],

      axes: [
        { scale: "x", grid: { stroke: "#e5e5e5" } },
        { scale: "y", grid: { stroke: "#e5e5e5" } },
      ],

      cursor: { drag: { x: true, y: false } },
      legend: { show: true },
    };

    uplotRef.current = new Uplot(
      opts,
      [chartData.time, chartData.mean, chartData.plusStd, chartData.minusStd],
      chartRef.current,
    );

    return () => uplotRef.current?.destroy();
  }, [chartData, height]);

  return (
    <div>
      <div
        style={{
          marginBottom: "10px",
          textAlign: "right",
          display: "flex",
          gap: "6px",
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <button onClick={() => quickZoom(30)}>30 дней</button>
        <button onClick={() => quickZoom(90)}>3 месяца</button>
        <button onClick={() => quickZoom(365)}>1 год</button>
        <button onClick={() => quickZoom(365 * 3)}>3 года</button>
        {isZoomed && (
          <button
            onClick={resetZoom}
            style={{ background: "#dc3545", color: "white" }}
          >
            Сбросить зум
          </button>
        )}
      </div>

      <div ref={chartRef} style={{ width: "100%", minHeight: height }} />
    </div>
  );
}
