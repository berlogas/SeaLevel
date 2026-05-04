import duckdb

conn = duckdb.connect(r'N:\Development\SeaLevel\backend\sealevel.duckdb')

rows = conn.execute("""
    SELECT epoch_ms(time_bucket(INTERVAL '10 minutes', EPOCH_MS(timestamp_ms))) AS bucket,
           COUNT(*) AS cnt
    FROM sea_readings
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 5
""").fetchall()

print("Last 5 buckets:")
for r in rows:
    print(f"Bucket: {r[0]}, Count: {r[1]}")

# Check max timestamp
max_ts = conn.execute("SELECT MAX(timestamp_ms) FROM sea_readings").fetchone()[0]
print(f"\nMax timestamp_ms: {max_ts}")