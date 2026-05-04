import duckdb

conn = duckdb.connect(r'N:\Development\SeaLevel\backend\sealevel.duckdb')

# Get min/max dates
minmax = conn.execute('SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM sea_readings').fetchone()
print(f"DB range: {minmax[0]} - {minmax[1]}")

# Simulate what backend does for 10min aggregation
group_expr = "epoch_ms(time_bucket(INTERVAL '10 minutes', EPOCH_MS(timestamp_ms)))"

# Use dates that would cover the entire period
start_ms = minmax[0]
end_ms = minmax[1]

query = f"""
    SELECT {group_expr} AS ts, AVG(level) AS mean, COUNT(*) AS count
    FROM sea_readings
    WHERE timestamp_ms BETWEEN {start_ms} AND {end_ms}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 10
"""

rows = conn.execute(query).fetchall()
print("\nLast 10 aggregated points (10min):")
for r in rows:
    from datetime import datetime
    ts = r[0] / 1000
    print(f"ts={r[0]}, date={datetime.fromtimestamp(ts)}, count={r[2]}")