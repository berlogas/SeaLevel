import duckdb

conn = duckdb.connect(r'N:\Development\SeaLevel\backend\sealevel.duckdb')

group_expr = "epoch_ms(time_bucket(INTERVAL '10 minutes', EPOCH_MS(timestamp_ms)))"

# Simulate what frontend sends - full range from dateRange
minmax = conn.execute('SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM sea_readings').fetchone()

# dateRange.start = "03.11.2023" -> 2023-11-03
# dateRange.end = "31.03.2026" -> 2026-03-31
from datetime import datetime, timezone

start_str = "03.11.2023"
end_str = "31.03.2026"

start_dt = datetime.strptime(start_str, "%d.%m.%Y").replace(tzinfo=timezone.utc)
end_dt = datetime.strptime(end_str, "%d.%m.%Y").replace(tzinfo=timezone.utc)

start_ms = int(start_dt.timestamp() * 1000)
end_ms = int(end_dt.timestamp() * 1000) + 86400000  # +1 day

print(f"Query range: {start_ms} to {end_ms}")
print(f"DB range: {minmax[0]} to {minmax[1]}")

# Get count before downsampling
raw_count = conn.execute(f"""
    SELECT COUNT(*) FROM (
        SELECT {group_expr} AS ts
        FROM sea_readings
        WHERE timestamp_ms BETWEEN {start_ms} AND {end_ms}
        GROUP BY 1
    )
""").fetchone()[0]

print(f"Raw aggregated points: {raw_count}")

# Check last few points
last_points = conn.execute(f"""
    SELECT {group_expr} AS ts, AVG(level) AS mean, COUNT(*) AS cnt
    FROM sea_readings
    WHERE timestamp_ms BETWEEN {start_ms} AND {end_ms}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 5
""").fetchall()

print("\nLast 5 points:")
for p in last_points:
    from datetime import datetime
    ts = p[0] / 1000
    print(f"  {datetime.fromtimestamp(ts)}: count={p[2]}")