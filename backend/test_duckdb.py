import duckdb
import os

conn = duckdb.connect('test.duckdb')
conn.execute('CREATE TABLE IF NOT EXISTS sea_readings (timestamp_ms BIGINT, level DOUBLE, source_file VARCHAR)')

conn.execute("""
    INSERT INTO sea_readings SELECT 
        CAST(epoch_ms(strptime(date_col || ' ' || time_col, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT),
        level_col,
        'test.dat'
    FROM read_csv("N:/Development/SeaLevel/test.dat", 
        header=false, 
        sep=" ",
        columns={'date_col': 'VARCHAR', 'time_col': 'VARCHAR', 'level_col': 'DOUBLE'})
    WHERE date_col IS NOT NULL AND level_col IS NOT NULL AND date_col != ''
""")

print('Count:', conn.execute('SELECT COUNT(*) FROM sea_readings').fetchone()[0])
print(conn.execute('SELECT * FROM sea_readings LIMIT 3').fetchall())
conn.close()