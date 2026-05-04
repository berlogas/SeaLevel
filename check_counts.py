import duckdb

conn = duckdb.connect(r'N:\Development\SeaLevel\backend\sealevel.duckdb')

group_expr = "epoch_ms(time_bucket(INTERVAL '10 minutes', EPOCH_MS(timestamp_ms)))"

# Test 1: Full range
minmax = conn.execute('SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM sea_readings').fetchone()
full_count = conn.execute(f"""
    SELECT COUNT(*) FROM (
        SELECT {group_expr} AS ts
        FROM sea_readings
        WHERE timestamp_ms BETWEEN {minmax[0]} AND {minmax[1]}
        GROUP BY 1
    )
""").fetchone()[0]
print(f"Full range: {full_count} points")

# Test 2: Last 30 days
end_ms = minmax[1]
start_ms = end_ms - 30 * 24 * 3600 * 1000
last30_count = conn.execute(f"""
    SELECT COUNT(*) FROM (
        SELECT {group_expr} AS ts
        FROM sea_readings
        WHERE timestamp_ms BETWEEN {start_ms} AND {end_ms}
        GROUP BY 1
    )
""").fetchone()[0]
print(f"Last 30 days: {last30_count} points")

# Test 3: Last month check - what's the actual date range being used?
# Let's simulate what happens with date parsing in Rust
from datetime import datetime, timezone
# end_date = "2026-03-31" -> timestamp for 2026-03-31 00:00:00 UTC
end_date_str = "2026-03-31"
dt = datetime.strptime(end_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
end_parsed_ms = int(dt.timestamp() * 1000)
end_with_day = end_parsed_ms + 86400000  # +1 day
print(f"\nend_date='{end_date_str}' -> {end_parsed_ms} -> +1 day = {end_with_day}")
print(f"Actual max in DB: {minmax[1]}")
print(f"Difference: {end_with_day - minmax[1]} ms ({ (end_with_day - minmax[1])/86400000 } days)")