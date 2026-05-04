use duckdb::{Connection, params, Error as DbError, Row};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{State, Window, Emitter};

const MAX_CHART_POINTS: usize = 5500;

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

const MIN_VALID_TS: i64 = 946_684_800_000;

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
    Connection::open(&path).map_err(|e| e.to_string())
}

// ==================== СОЗДАНИЕ СОСТОЯНИЯ ====================

pub fn create_state_from_path(app_dir: PathBuf, db_name: &str) -> AppState {
    let db_path = app_dir.join(db_name);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    AppState {
        db_path: Mutex::new(db_path),
    }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

fn format_datetime(ts_ms: i64, freq: &str) -> String {
    let dt = match chrono::DateTime::from_timestamp(ts_ms / 1000, 0) {
        Some(d) => d,
        None => return "—".to_string(),
    };
    let year2 = dt.format("%y").to_string();

    match freq {
        "10min" | "hour" => dt.format(&format!("%d.%m.{} %H:%M", year2)).to_string(),
        _ => dt.format(&format!("%d.%m.{}", year2)).to_string(),
    }
}

fn add_gap_points(data: &[DataPoint], interval_ms: i64, freq: &str) -> Vec<DataPoint> {
    let gap_threshold = interval_ms * 3 / 2;
    let mut result = Vec::with_capacity(data.len());
    let mut prev_ts: Option<i64> = None;

    for point in data {
        if let Some(prev) = prev_ts {
            if point.timestamp - prev > gap_threshold {
                let gap_ts = prev + (point.timestamp - prev) / 2;
                result.push(DataPoint {
                    datetime: format_datetime(gap_ts, freq),
                    timestamp: gap_ts,
                    mean: None, std: None, min: None, max: None, count: 0,
                });
            }
        }
        let mut p = point.clone();
        p.datetime = format_datetime(p.timestamp, freq);
        result.push(p);
        prev_ts = Some(point.timestamp);
    }
    result
}

fn get_group_expr(freq: &str) -> String {
    match freq {
        "10min" => "CAST(epoch_ms(date_trunc('minute', EPOCH_MS(timestamp_ms))) / 600000 * 600000 AS BIGINT)".to_string(),
        "hour"  => "CAST(epoch_ms(date_trunc('hour', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
        "day"   => "CAST(epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
        "decade"=> "CAST(epoch_ms(date_trunc('month', EPOCH_MS(timestamp_ms))) + (CASE WHEN EXTRACT(DAY FROM EPOCH_MS(timestamp_ms)) <= 10 THEN 0 WHEN EXTRACT(DAY FROM EPOCH_MS(timestamp_ms)) <= 20 THEN 864000000 ELSE 1728000000 END) AS BIGINT)".to_string(),
        "week"    => "CAST(epoch_ms(date_trunc('week', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
        "month"   => "CAST(epoch_ms(date_trunc('month', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
        "quarter" => "CAST(epoch_ms(date_trunc('quarter', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
        "year"    => "CAST(epoch_ms(date_trunc('year', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
        _         => "CAST(epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms))) AS BIGINT)".to_string(),
    }
}

fn get_interval_ms(freq: &str) -> i64 {
    match freq {
        "10min"  => 600_000,
        "hour"   => 3_600_000,
        "day"    => 86_400_000,
        "decade" => 864_000_000,
        "week"   => 604_800_000,
        "month"  => 2_629_746_000,
        "quarter"=> 7_889_238_000,
        "year"   => 31_556_952_000,
        _        => 86_400_000,
    }
}

fn downsample_points(data: Vec<DataPoint>, target: usize) -> Vec<DataPoint> {
    if data.len() <= target { return data; }
    let step = data.len() / target;
    (0..target).map(|i| data[(i * step).min(data.len() - 1)].clone()).collect()
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

fn chrono_from_ms(ms: i64) -> String {
    let secs = ms / 1000;
    chrono::DateTime::from_timestamp(secs, 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH)
        .format("%d.%m.%Y")
        .to_string()
}

// ==================== КОМАНДЫ ====================

#[tauri::command]
pub fn init_db(state: State<AppState>) -> Result<(), String> {
    log_to_file("INIT_DB: Starting...");
    let conn = open_db(&state)?;

    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS sea_readings (timestamp_ms BIGINT, level DOUBLE, source_file VARCHAR);
        CREATE INDEX IF NOT EXISTS idx_ts ON sea_readings(timestamp_ms);

        CREATE TABLE IF NOT EXISTS import_log (filename VARCHAR UNIQUE, status VARCHAR, records_count BIGINT, error_msg VARCHAR, imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

        CREATE TABLE IF NOT EXISTS aggregates (freq VARCHAR, ts BIGINT, mean DOUBLE, std DOUBLE, min DOUBLE, max DOUBLE, count BIGINT, calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (freq, ts));
        CREATE INDEX IF NOT EXISTS idx_agg_freq ON aggregates(freq);
    "#).map_err(|e: DbError| e.to_string())?;

    log_to_file("Tables initialized OK");
    Ok(())
}

#[tauri::command]
pub fn get_date_range(state: State<AppState>) -> Result<DateRange, String> {
    let conn = open_db(&state)?;

    let mut stmt = conn.prepare(
        "SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM sea_readings WHERE timestamp_ms > ?"
    ).map_err(|e: DbError| e.to_string())?;

    let result: Option<(i64, i64)> = stmt.query_row([&MIN_VALID_TS], |row: &Row| Ok((row.get(0)?, row.get(1)?))).ok();

    match result {
        Some((min, max)) => Ok(DateRange {
            start: Some(chrono_from_ms(min)),
            end: Some(chrono_from_ms(max)),
        }),
        None => Ok(DateRange { start: None, end: None }),
    }
}

#[tauri::command]
pub fn get_import_log(state: State<AppState>) -> Result<Vec<ImportFile>, String> {
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
pub fn aggregate(
    start_date: String,
    end_date: String,
    freq: String,
    state: State<AppState>,
) -> Result<AggregateResponse, String> {
    let conn = open_db(&state)?;
    let start_ms = parse_date_to_ms(&start_date)?;
    let end_ms = parse_date_to_ms(&end_date)? + 86_400_000;

    let group_expr = get_group_expr(&freq);
    let interval_ms = get_interval_ms(&freq);

    let query = format!(
        "SELECT {} AS ts, AVG(level) AS mean, STDDEV_SAMP(level) AS std,
                MIN(level) AS min, MAX(level) AS max, COUNT(*) AS count
         FROM sea_readings WHERE timestamp_ms BETWEEN {} AND {} GROUP BY 1 ORDER BY 1",
        group_expr, start_ms, end_ms
    );

    let mut rows: Vec<DataPoint> = conn.prepare(&query)
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
        })
        .map_err(|e: DbError| e.to_string())?
        .flatten()
        .collect();

    let raw_count = rows.len();

    if raw_count > MAX_CHART_POINTS {
        rows = downsample_points(rows, MAX_CHART_POINTS);
    }

    let final_data = add_gap_points(&rows, interval_ms, &freq);
    let total_records: i64 = rows.iter().map(|p| p.count).sum();

    Ok(AggregateResponse {
        data: final_data,
        stats: serde_json::json!({
            "count": rows.len(),
            "raw_count": raw_count,
            "total_records": total_records,
            "freq_used": freq,
            "was_downsampled": raw_count > MAX_CHART_POINTS,
            "max_limit": MAX_CHART_POINTS
        }),
    })
}

#[tauri::command]
pub fn import_files(
    files: Vec<String>,
    state: State<AppState>,
    window: Window,
) -> Result<serde_json::Value, String> {
    log_to_file(&format!("IMPORT START: {} files", files.len()));
    let conn = open_db(&state)?;

    let total_files = files.len();
    let mut total_records = 0i64;
    let mut files_processed = 0i32;
    let start_time = std::time::Instant::now();

    for (index, file_path) in files.iter().enumerate() {
        let progress = ((index as f32 / total_files as f32) * 100.0) as u8;
        let filename = std::path::PathBuf::from(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let _ = window.emit("import-progress", serde_json::json!({
            "progress": progress,
            "current": index + 1,
            "total": total_files,
            "filename": filename,
            "status": "Обработка файла..."
        }));

        let exists: Option<String> = conn.query_row(
            "SELECT status FROM import_log WHERE filename = ? AND status = 'ready'",
            params![&filename],
            |row: &Row| row.get(0),
        ).ok();

        if exists.is_some() { continue; }

        let _ = conn.execute(
            "INSERT OR REPLACE INTO import_log (filename, status) VALUES (?, 'indexing')",
            params![&filename],
        );

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

                let _ = conn.execute(
                    "UPDATE import_log SET status='ready', records_count=? WHERE filename=?",
                    params![&count, &filename],
                );
            }
            Err(e) => {
                log_to_file(&format!("IMPORT ERROR {}: {}", filename, e));
                let _ = conn.execute(
                    "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                    params![&e.to_string(), &filename],
                );
            }
        }

        let elapsed = start_time.elapsed().as_secs_f32();
        let speed = if elapsed > 0.0 { (total_records as f32 / elapsed).round() } else { 0.0 };

        let _ = window.emit("import-progress", serde_json::json!({
            "progress": ((index as f32 + 1.0) / total_files as f32 * 100.0) as u8,
            "current": index + 1,
            "total": total_files,
            "filename": filename,
            "status": format!("Обработано {} записей • {:.0} записей/сек", total_records, speed),
        }));
    }

    let _ = window.emit("import-progress", serde_json::json!({
        "progress": 100,
        "finished": true,
        "status": format!("Импорт завершён! Добавлено {} записей", total_records)
    }));

    let _ = conn.execute("DELETE FROM aggregates", []);

    log_to_file("IMPORT: completed");

    Ok(serde_json::json!({
        "status": "completed",
        "files_processed": files_processed,
        "records_count": total_records,
    }))
}
