use duckdb::{Connection, params, Error as DbError, Row};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

fn get_log_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sealevel.log")
}

fn log_to_file(msg: &str) {
    let path = get_log_path();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let ts = chrono::Local::now().format("%H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] {}", ts, msg);
    }
}

const MIN_VALID_TS: i64 = 946_684_800_000; // 2000-01-01 UTC

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportFile {
    pub filename: String,
    pub status: String,
    pub records_count: i64,
    pub imported_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataPoint {
    pub datetime: String,
    pub timestamp: i64,
    pub mean: Option<f64>,
    pub std: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AggregateResponse {
    pub data: Vec<DataPoint>,
    pub stats: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DateRange {
    pub start: Option<String>,
    pub end: Option<String>,
}

pub struct AppState {
    pub db_path: Mutex<PathBuf>,
}

fn get_db_path(state: &State<AppState>) -> PathBuf {
    state.db_path.lock().unwrap().clone()
}

fn open_db(state: &State<AppState>) -> Result<Connection, String> {
    let path = get_db_path(state);
    Connection::open(&path).map_err(|e| {
        log_to_file(&format!("DB open error: {}", e));
        e.to_string()
    })
}

pub fn create_state_from_path(app_dir: PathBuf, db_name: &str) -> AppState {
    let db_path = app_dir.join(db_name);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    AppState {
        db_path: Mutex::new(db_path),
    }
}

#[tauri::command]
pub fn init_db(state: State<AppState>) -> Result<(), String> {
    log_to_file("INIT_DB: Starting...");
    let db_path = get_db_path(&state);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS sea_readings (
            timestamp_ms BIGINT,
            level DOUBLE,
            source_file VARCHAR
        );
        CREATE INDEX IF NOT EXISTS idx_ts ON sea_readings(timestamp_ms);

        CREATE TABLE IF NOT EXISTS import_log (
            filename VARCHAR UNIQUE,
            status VARCHAR,
            records_count BIGINT,
            error_msg VARCHAR,
            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS aggregates (
            freq VARCHAR,
            ts BIGINT,
            mean DOUBLE,
            std DOUBLE,
            min DOUBLE,
            max DOUBLE,
            count BIGINT,
            calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (freq, ts)
        );
        CREATE INDEX IF NOT EXISTS idx_agg_freq ON aggregates(freq);
    "#).map_err(|e: DbError| e.to_string())?;

    log_to_file("Tables initialized OK");
    Ok(())
}

#[tauri::command]
pub fn get_date_range(state: State<AppState>) -> Result<DateRange, String> {
    log_to_file("GET_DATE_RANGE: start");
    let conn = open_db(&state)?;
    let mut stmt = conn.prepare(
        "SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM sea_readings WHERE timestamp_ms > ?"
    ).map_err(|e: DbError| e.to_string())?;

    let result: Option<(i64, i64)> = stmt.query_row(
        [&MIN_VALID_TS],
        |row: &Row| Ok((row.get(0)?, row.get(1)?))
    ).ok();

    match result {
        Some((min, max)) => Ok(DateRange {
            start: Some(chrono_from_ms(min)),
            end: Some(chrono_from_ms(max)),
        }),
        None => Ok(DateRange { start: None, end: None }),
    }
}

fn chrono_from_ms(ms: i64) -> String {
    let secs = ms / 1000;
    chrono::DateTime::from_timestamp(secs, 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH)
        .format("%d.%m.%Y")
        .to_string()
}

#[tauri::command]
pub fn get_import_log(state: State<AppState>) -> Result<Vec<ImportFile>, String> {
    log_to_file("GET_IMPORT_LOG: start");
    let conn = open_db(&state)?;
    let mut stmt = conn.prepare(
        "SELECT filename, status, records_count, imported_at FROM import_log ORDER BY imported_at DESC"
    ).map_err(|e: DbError| e.to_string())?;

    let rows = stmt.query_map([], |row: &Row| {
        Ok(ImportFile {
            filename: row.get(0)?,
            status: row.get(1)?,
            records_count: row.get(2)?,
            imported_at: row.get(3).ok(),
        })
    }).map_err(|e: DbError| e.to_string())?;

    Ok(rows.flatten().collect())
}

#[tauri::command]
pub fn import_files(files: Vec<String>, state: State<AppState>) -> Result<serde_json::Value, String> {
    log_to_file(&format!("IMPORT: {} files", files.len()));
    let conn = open_db(&state)?;
    let mut total_records = 0i64;
    let mut files_processed = 0i32;

    for file_path in files {
        let filename = PathBuf::from(&file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let exists: Option<String> = conn.query_row(
            "SELECT status FROM import_log WHERE filename = ? AND status = 'ready'",
            params![&filename],
            |row: &Row| row.get(0),
        ).ok();
        if exists.is_some() { continue; }

        conn.execute(
            "INSERT OR REPLACE INTO import_log (filename, status) VALUES (?, 'indexing')",
            params![&filename],
        ).ok();

        let safe_path = file_path.replace("'", "''");
        let safe_name = filename.replace("'", "''");

        let query = format!(
            "INSERT INTO sea_readings (timestamp_ms, level, source_file)
             SELECT CAST(epoch_ms(strptime(col0 || ' ' || col1, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT),
                    col2::DOUBLE, '{}'
             FROM read_csv('{}', header=false, sep=' ', auto_detect=false, sample_size=-1,
                 columns={{'col0': 'VARCHAR', 'col1': 'VARCHAR', 'col2': 'DOUBLE'}})
             WHERE col0 IS NOT NULL AND col0 != '' AND col2 IS NOT NULL
               AND CAST(epoch_ms(strptime(col0 || ' ' || col1, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT) > {}",
            safe_name, safe_path, MIN_VALID_TS
        );

        match conn.execute(&query, []) {
            Ok(_) => {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sea_readings WHERE source_file = ?",
                    params![&filename],
                    |row: &Row| row.get(0),
                ).unwrap_or(0);

                if count > 0 {
                    files_processed += 1;
                    total_records += count;
                }
                conn.execute(
                    "UPDATE import_log SET status='ready', records_count=? WHERE filename=?",
                    params![&count, &filename],
                ).ok();
            }
            Err(e) => {
                log_to_file(&format!("IMPORT ERROR {}: {}", filename, e));
                conn.execute(
                    "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                    params![&e.to_string(), &filename],
                ).ok();
            }
        }
    }

    conn.execute("DELETE FROM aggregates", []).ok();
    log_to_file("IMPORT: done");
    Ok(serde_json::json!({
        "status": "completed",
        "files_processed": files_processed,
        "records_count": total_records,
    }))
}

#[tauri::command]
pub fn aggregate(
    start_date: String,
    end_date: String,
    freq: String,
    state: State<AppState>,
) -> Result<AggregateResponse, String> {
    log_to_file(&format!("AGGREGATE START: {} {} freq={}", start_date, end_date, freq));
    let mut conn = open_db(&state)?;
    let start_ms = parse_date_to_ms(&start_date)?;
    let end_ms = parse_date_to_ms(&end_date)? + 86_400_000;

    // 🔥 1. Нормализуем входной параметр (убираем пробелы, если они есть)
    let freq_clean = freq.trim();

    // 🔥 2. Исправленные выражения для DuckDB (ключи БЕЗ пробелов)
    let group_expr = match freq_clean {
        "10min"   => "(timestamp_ms / 600000) * 600000",
        "hour"    => "CAST(epoch_ms(date_trunc('hour', EPOCH_MS(timestamp_ms))) AS BIGINT)",
        "day"     => "CAST(epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms))) AS BIGINT)",
        "week"    => "CAST(epoch_ms(date_trunc('week', EPOCH_MS(timestamp_ms))) AS BIGINT)",
        "month"   => "CAST(epoch_ms(date_trunc('month', EPOCH_MS(timestamp_ms))) AS BIGINT)",
        "quarter" => "CAST(epoch_ms(date_trunc('quarter', EPOCH_MS(timestamp_ms))) AS BIGINT)",
        "year"    => "CAST(epoch_ms(date_trunc('year', EPOCH_MS(timestamp_ms))) AS BIGINT)",
        // 🔥 Формула декады: (день_месяца - 1) % 10 * INTERVAL '1 day'
        "decade"  => "CAST(epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms)) - ((CAST(date_part('day', EPOCH_MS(timestamp_ms)) AS INTEGER) - 1) % 10) * INTERVAL '1 DAY') AS BIGINT)",
        _         => "CAST(epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms))) AS BIGINT)",
    };

    let interval_ms = match freq_clean {
        "10min"   => 600_000,
        "hour"    => 3_600_000,
        "day"     => 86_400_000,
        "week"    => 604_800_000,
        "decade"  => 864_000_000,
        "month"   => 2_629_746_000,
        "quarter" => 7_889_238_000,
        "year"    => 31_556_952_000,
        _         => 86_400_000,
    };

    log_to_file(&format!("FREQ_CLEAN='{}' INTERVAL={}", freq_clean, interval_ms));

    log_to_file("CACHE CHECK...");
    let cached: Vec<DataPoint> = {
        let mut stmt = conn.prepare(
            "SELECT ts, mean, std, min, max, count FROM aggregates
             WHERE freq = ? AND ts >= ? AND ts < ? ORDER BY ts"
        ).map_err(|e: DbError| e.to_string())?;

        stmt.query_map(params![&freq_clean, start_ms, end_ms], |row: &Row| {
            Ok(DataPoint {
                datetime: String::new(),
                timestamp: row.get(0)?,
                mean: row.get(1).ok(),
                std: row.get(2).ok(),
                min: row.get(3).ok(),
                max: row.get(4).ok(),
                count: row.get::<_, i64>(5).unwrap_or(0),
            })
        }).map_err(|e: DbError| e.to_string())?
        .flatten().collect()
    };

    if !cached.is_empty() {
        log_to_file(&format!("CACHE HIT: {} points", cached.len()));
        let count = cached.len();
        let total: i64 = cached.iter().map(|p| p.count).sum();
        return Ok(AggregateResponse {
            data: add_gap_points(&cached, interval_ms),
            stats: serde_json::json!({"count": count, "total_records": total}),
        });
    }

    log_to_file("CACHE MISS - COMPUTING...");
    let query = format!(
        "SELECT {} AS ts, AVG(level) AS mean, STDDEV_SAMP(level) AS std,
               MIN(level) AS min, MAX(level) AS max, COUNT(*) AS count
         FROM sea_readings
         WHERE timestamp_ms BETWEEN {} AND {}
         GROUP BY 1 ORDER BY 1",
        group_expr, start_ms, end_ms
    );

    let rows: Vec<DataPoint> = conn.prepare(&query)
        .map_err(|e: DbError| e.to_string())?
        .query_map([], |row: &Row| {
            Ok(DataPoint {
                datetime: String::new(),
                timestamp: row.get(0)?,
                mean: row.get(1).ok(),
                std: row.get(2).ok(),
                min: row.get(3).ok(),
                max: row.get(4).ok(),
                count: row.get::<_, i64>(5).unwrap_or(0),
            })
        }).map_err(|e: DbError| e.to_string())?
        .flatten().collect();

    log_to_file(&format!("COMPUTED {} points", rows.len()));

    if !rows.is_empty() {
        let tx = conn.transaction().map_err(|e: DbError| e.to_string())?;
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO aggregates (freq, ts, mean, std, min, max, count) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).map_err(|e: DbError| e.to_string())?;

        for row in &rows {
            stmt.execute(params![
                &freq_clean, row.timestamp, row.mean, row.std, row.min, row.max, row.count
            ]).map_err(|e: DbError| e.to_string())?;
        }
        tx.commit().map_err(|e: DbError| e.to_string())?;
        log_to_file("CACHE SAVED");
    }

    let count = rows.iter().filter(|p| p.mean.is_some()).count();
    let total: i64 = rows.iter().map(|p| p.count).sum();

    log_to_file("AGGREGATE DONE");
    Ok(AggregateResponse {
        data: add_gap_points(&rows, interval_ms),
        stats: serde_json::json!({"count": count, "total_records": total}),
    })
}

fn add_gap_points(data: &[DataPoint], interval_ms: i64) -> Vec<DataPoint> {
    let gap_threshold = interval_ms * 3 / 2;
    let mut result = Vec::with_capacity(data.len());
    let mut prev_ts: Option<i64> = None;

    for point in data {
        if let Some(prev) = prev_ts {
            if point.timestamp - prev > gap_threshold {
                result.push(DataPoint {
                    datetime: String::new(),
                    // Ставим метку в середину разрыва, чтобы график не уходил в 1970 год
                    timestamp: prev + (point.timestamp - prev) / 2,
                    mean: None, std: None, min: None, max: None, count: 0,
                });
            }
        }
        result.push(point.clone());
        prev_ts = Some(point.timestamp);
    }
    result
}

fn parse_date_to_ms(date_str: &str) -> Result<i64, String> {
    if let Ok(dt) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return Ok(dt.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis());
    }
    if let Ok(dt) = chrono::NaiveDate::parse_from_str(date_str, "%d.%m.%Y") {
        return Ok(dt.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis());
    }
    Err(format!("Invalid date: {}", date_str))
}
