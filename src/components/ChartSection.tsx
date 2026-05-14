import { memo } from "react";
import SeaLevelUPlot from "./SeaLevelUPlot";

interface DataPoint {
  timestamp: number;
  mean: number | null;
  std?: number | null;
}

interface Props {
  aggregateData: DataPoint[];
  frequency: string;
  isLoading: boolean;
}

const ChartSection = memo(({ aggregateData, frequency, isLoading }: Props) => {
  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 500 }}>
        <p>Загрузка данных...</p>
      </div>
    );
  }

  if (!aggregateData || aggregateData.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 500 }}>
        <p>Выберите Дискретность и нажмите Рассчитать</p>
      </div>
    );
  }

  return (
    <div>
      {/* <h3 style={{ marginBottom: 20 }}>График</h3> */}
      <SeaLevelUPlot data={aggregateData} frequency={frequency} height={400} />
    </div>
  );
});

ChartSection.displayName = "ChartSection";

export default ChartSection;
