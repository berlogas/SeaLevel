use duckdb::{Connection, params, Error as DbError};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{State, AppHandle, Emitter};

const MAX_CHART_POINTS: usize = 10000;

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
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    // Оптимизация: увеличиваем число потоков и лимит памяти для импорта
    conn.execute_batch("PRAGMA threads=4; PRAGMA memory_limit='4GB';").ok();
    Ok(conn)
}

pub fn create_state_from_path(app_dir: PathBuf, db_name: &str) -> AppState {
    let db_path = app_dir.join(db_name);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    AppState { db_path: Mutex::new(db_path) }
}

fn format_datetime(ts_ms: i64, freq: &str) -> String {
    let dt = match chrono::DateTime::from_timestamp(ts_ms / 1000, 0) {
        Some(d) => d,
        None => return "—".to_string(),
    };
    let year2 = dt.format("%y").to_string();
    match freq {
        "second" => dt.format(&format!("%d.%m.{} %H:%M:%S", year2)).to_string(),
        "10min" | "hour" => dt.format(&format!("%d.%m.{} %H:%M", year2)).to_string(),
        _ => dt.format(&format!("%d.%m.{}", year2)).to_string(),
    }
}

fn add_gap_points(data: &[DataPoint], interval_ms: i64, freq: &str) -> Vec<DataPoint> {
    if data.is_empty() {
        log_to_file("add_gap_points: empty data");
        return vec![];
    }

    let gap_threshold = match freq {
        "second" => 10_000i64,
        "10min" => 20 * 60_000i64,
        _       => (interval_ms as f64 * 1.5) as i64,
    };

    let max_gap_to_fill = match freq {
        "second" => 60_000i64,
        "10min" => 3 * 24 * 60 * 60_000i64,
        _       => interval_ms * 2,
    };

    log_to_file(&format!(
        "add_gap_points START: {} raw points | freq={} | gap_threshold={} ms ({:.1}h) | max_fill={} ms ({:.1}h)",
        data.len(), freq, gap_threshold, gap_threshold as f64 / 3600000.0, max_gap_to_fill, max_gap_to_fill as f64 / 3600000.0
    ));
    log_to_file(&format!("  First point: {} | Last point: {}", data[0].timestamp, data[data.len()-1].timestamp));

    let mut result = Vec::with_capacity(data.len() * 2);
    let mut expected_ts = data[0].timestamp;
    let mut p = data[0].clone();
    p.datetime = format_datetime(p.timestamp, freq);
    result.push(p);

    for current in &data[1..] {
        let diff = current.timestamp - expected_ts;
        if diff > gap_threshold {
            if diff <= max_gap_to_fill {
                let steps = ((diff as f64) / (interval_ms as f64)).ceil() as i64 - 1;
                log_to_file(&format!(
                    "GAP → diff={} ms ({:.1} intervals) → inserting {} null points",
                    diff, diff as f64 / interval_ms as f64, steps
                ));
                for i in 1..=steps {
                    let gap_ts = expected_ts + i * interval_ms;
                    result.push(DataPoint {
                        datetime: format_datetime(gap_ts, freq),
                        timestamp: gap_ts,
                        mean: None,
                        std: None,
                        min: None,
                        max: None,
                        count: 0,
                    });
                }
            } else {
                log_to_file(&format!("BIG GAP ({} ms) → inserting 1 null point", diff));
                let gap_ts = expected_ts + diff / 2;
                result.push(DataPoint {
                    datetime: format_datetime(gap_ts, freq),
                    timestamp: gap_ts,
                    mean: None,
                    std: None,
                    min: None,
                    max: None,
                    count: 0,
                });
            }
        } else if diff > interval_ms {
            log_to_file(&format!("Small gap ignored: {} ms", diff));
        }
        let mut p = current.clone();
        p.datetime = format_datetime(p.timestamp, freq);
        result.push(p);
        expected_ts = current.timestamp;
    }

    while result.last().map_or(false, |p| p.mean.is_none()) {
        result.pop();
    }

    let null_count = result.iter().filter(|p| p.mean.is_none()).count();
    let last_ts = result.last().map_or(0, |p| p.timestamp);
    let last_real = data.last().map_or(0, |p| p.timestamp);
    log_to_file(&format!(
        "add_gap_points FINISHED: {} total points ({} nulls inserted)",
        result.len(), null_count
    ));
    log_to_file(&format!("  Last point in result: {} | Last REAL point: {} | diff={} ms",
        last_ts, last_real, last_ts - last_real
    ));
    result
}

fn get_group_expr(freq: &str) -> String {
    match freq {
        "second" => "(timestamp_ms / 1000) * 1000".to_string(),
        "10min" => "epoch_ms(time_bucket(INTERVAL '10 minutes', EPOCH_MS(timestamp_ms)))".to_string(),
        "hour"  => "epoch_ms(date_trunc('hour', EPOCH_MS(timestamp_ms)))".to_string(),
        "day"   => "epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms)))".to_string(),
        "week"  => "epoch_ms(date_trunc('week', EPOCH_MS(timestamp_ms)))".to_string(),
        "month" => "epoch_ms(date_trunc('month', EPOCH_MS(timestamp_ms)))".to_string(),
        "quarter" => "epoch_ms(date_trunc('quarter', EPOCH_MS(timestamp_ms)))".to_string(),
        "year"  => "epoch_ms(date_trunc('year', EPOCH_MS(timestamp_ms)))".to_string(),
        "decade" =>
            "epoch_ms(date_trunc('month', EPOCH_MS(timestamp_ms))) +
            (CASE WHEN EXTRACT(DAY FROM EPOCH_MS(timestamp_ms)) <= 10 THEN 0
            WHEN EXTRACT(DAY FROM EPOCH_MS(timestamp_ms)) <= 20 THEN 864000000
            ELSE 1728000000 END)".to_string(),
        _ => "epoch_ms(date_trunc('day', EPOCH_MS(timestamp_ms)))".to_string(),
    }
}

fn get_interval_ms(freq: &str) -> i64 {
    match freq {
        "second" => 1_000,
        "10min"  => 600_000,
        "hour"   => 3_600_000,
        "day"    => 86_400_000,
        "week"   => 604_800_000,
        "month"  => 2_629_746_000,
        "quarter"=> 7_889_238_000,
        "year"   => 31_556_952_000,
        "decade" => 864_000_000,
        _        => 86_400_000,
    }
}

fn downsample_points(data: Vec<DataPoint>, target: usize) -> Vec<DataPoint> {
    if data.len() <= target {
        return data;
    }
    let step = (data.len() as f64 / target as f64).round() as usize;
    (0..target).map(|i| data[(i * step).min(data.len() - 1)].clone()).collect()
}

#[tauri::command]
pub fn export_full_data(
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
         FROM sea_readings
         WHERE timestamp_ms BETWEEN {} AND {}
         GROUP BY 1 ORDER BY 1",
        group_expr, start_ms, end_ms
    );
    log_to_file(&format!("EXPORT_FULL freq={}, query starts with: {}", freq, &query[..std::cmp::min(280, query.len())]));

    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(e) => return Err(format!("Prepare error: {}", e)),
    };

    let rows: Vec<DataPoint> = stmt
        .query_map([], |row| {
            Ok(DataPoint {
                datetime: String::new(),
                timestamp: row.get(0).unwrap_or(0),
                mean: row.get(1).ok(),
                std: row.get(2).ok(),
                min: row.get(3).ok(),
                max: row.get(4).ok(),
                count: row.get(5).unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    log_to_file(&format!("EXPORT_FULL SUCCESS: {} points for freq={}", rows.len(), freq));
    let with_gaps = add_gap_points(&rows, interval_ms, &freq);

    Ok(AggregateResponse {
        data: with_gaps.clone(),
        stats: serde_json::json!({
            "count": with_gaps.len(),
            "raw_aggregated": rows.len(),
            "freq_used": freq,
        }),
    })
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
         FROM sea_readings
         WHERE timestamp_ms BETWEEN {} AND {}
         GROUP BY 1 ORDER BY 1",
        group_expr, start_ms, end_ms
    );
    log_to_file(&format!("AGGREGATE freq={}, query starts with: {}", freq, &query[..std::cmp::min(280, query.len())]));

    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(e) => return Err(format!("Prepare error: {}", e)),
    };

    let rows: Vec<DataPoint> = stmt
        .query_map([], |row| {
            Ok(DataPoint {
                datetime: String::new(),
                timestamp: row.get(0).unwrap_or(0),
                mean: row.get(1).ok(),
                std: row.get(2).ok(),
                min: row.get(3).ok(),
                max: row.get(4).ok(),
                count: row.get(5).unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    log_to_file(&format!("AGGREGATE SUCCESS: {} points for freq={} | min={:.2} max={:.2}", 
        rows.len(), freq, 
        rows.iter().filter_map(|r| r.min).fold(f64::INFINITY, |a, b| a.min(b)),
        rows.iter().filter_map(|r| r.max).fold(f64::NEG_INFINITY, |a, b| a.max(b))
    ));
    let with_gaps = add_gap_points(&rows, interval_ms, &freq);
    let nulls_before = with_gaps.iter().filter(|p| p.mean.is_none()).count();

    let max_points = match freq.as_str() {
        "second" | "10min" => MAX_CHART_POINTS,
        _ => with_gaps.len(),
    };

    let final_data = downsample_points(with_gaps.clone(), max_points);
    let nulls_after = final_data.iter().filter(|p| p.mean.is_none()).count();
    log_to_file(&format!("DOWNSAMPLE: {} -> {} points (nulls: {} -> {})", with_gaps.len(), final_data.len(), nulls_before, nulls_after));

    Ok(AggregateResponse {
        data: final_data.clone(),
        stats: serde_json::json!({
            "count": final_data.len(),
            "raw_aggregated": rows.len(),
            "with_gaps": with_gaps.len(),
            "freq_used": freq,
        }),
    })
}

#[tauri::command]
pub fn init_db(state: State<AppState>) -> Result<(), String> {
    log_to_file("INIT_DB: Starting...");
    let conn = open_db(&state)?;
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS sea_readings (timestamp_ms BIGINT, level DOUBLE, source_file VARCHAR);
        CREATE INDEX IF NOT EXISTS idx_ts ON sea_readings(timestamp_ms);
        CREATE TABLE IF NOT EXISTS import_log (filename VARCHAR UNIQUE, status VARCHAR, records_count BIGINT, error_msg VARCHAR, imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
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

    let result: Option<(i64, i64)> = stmt.query_row([&MIN_VALID_TS], |row| Ok((row.get(0)?, row.get(1)?))).ok();

    match result {
        Some((min, max)) => {
            let date_range = DateRange {
                start: Some(chrono_from_ms(min)),
                end: Some(chrono_from_ms(max)),
            };
            log_to_file(&format!("GET_DATE_RANGE: start={}, end={}", date_range.start.as_ref().unwrap_or(&"—".to_string()), date_range.end.as_ref().unwrap_or(&"—".to_string())));
            Ok(date_range)
        },
        None => {
            log_to_file("GET_DATE_RANGE: No data found");
            Ok(DateRange { start: None, end: None })
        }
    }
}

#[tauri::command]
pub fn get_import_log(state: State<AppState>) -> Result<Vec<ImportFile>, String> {
    let conn = open_db(&state)?;
    let mut stmt = conn.prepare(
        "SELECT filename, status, records_count, imported_at FROM import_log ORDER BY imported_at DESC"
    ).map_err(|e: DbError| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(ImportFile {
            filename: row.get(0)?,
            status: row.get(1)?,
            records_count: row.get(2)?,
            imported_at: row.get(3).ok(),
        })
    }).map_err(|e: DbError| e.to_string())?;

    Ok(rows.flatten().collect())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPayload {
    pub files: Vec<String>,
    pub filter_outliers: bool,
    pub half_window: usize,
    pub k: f64,
}

#[tauri::command]
pub fn import_files(
    payload: ImportPayload,
    state: State<AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let files = payload.files;
    let filter_outliers = payload.filter_outliers;
    let _half_window = payload.half_window;
    let k = payload.k;

    log_to_file(&format!("=== IMPORT START: {} files, filter={}, k={} ===", 
        files.len(), filter_outliers, k));
    let conn = open_db(&state)?;
    
    let total_files = files.len();
    let mut total_records = 0i64;
    let mut total_filtered = 0i64;
    let mut files_processed = 0i32;
    let start_time = std::time::Instant::now();

    // Оптимизация 1: при массовом импорте (>1 файл) временно удаляем индекс idx_ts.
    // Индекс сильно замедляет массовые INSERT, т.к. требует обновления B-tree на каждую запись.
    let use_bulk_opt = total_files > 1;
    if use_bulk_opt {
        log_to_file("IMPORT OPT: dropping index idx_ts for bulk import");
        conn.execute("DROP INDEX IF EXISTS idx_ts", []).ok();
    }

    for (index, file_path) in files.iter().enumerate() {
        let filename = std::path::PathBuf::from(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let _ = app.emit("import-progress", serde_json::json!({
            "progress": ((index as f32 / total_files as f32) * 100.0) as u8,
            "current": index + 1,
            "total": total_files,
            "filename": filename,
            "status": "Чтение файла..."
        }));

        let safe_path = file_path.replace("'", "''");
        let safe_name = filename.replace("'", "''");

        conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();

        // Шаг 1 — загружаем CSV во временную таблицу (auto-commit, вне транзакции)
        let read_query = format!(
            "CREATE TABLE import_temp AS
             SELECT CAST(epoch_ms(strptime(col0 || ' ' || col1, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT) as timestamp_ms,
                    col2::DOUBLE as level
             FROM read_csv('{}', header=false, sep=' ', auto_detect=false,
                 columns={{'col0': 'VARCHAR', 'col1': 'VARCHAR', 'col2': 'DOUBLE'}})
             WHERE col0 IS NOT NULL AND col0 != '' AND col2 IS NOT NULL
               AND CAST(epoch_ms(strptime(col0 || ' ' || col1, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT) > {}",
            safe_path, MIN_VALID_TS
        );

        if let Err(e) = conn.execute(&read_query, []) {
            log_to_file(&format!("IMPORT ERROR reading {}: {}", filename, e));
            let _ = conn.execute(
                "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                params![&e.to_string(), &filename],
            );
            continue;
        }

        // Шаг 2 — определяем полный диапазон дат из СЫРЫХ данных (до фильтрации)
        let (min_ts, max_ts, raw_count): (Option<i64>, Option<i64>, i64) = conn.query_row(
            "SELECT MIN(timestamp_ms), MAX(timestamp_ms), COUNT(*) FROM import_temp",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap_or((None, None, 0));

        let mut count: i64 = 0;

        if raw_count > 0 {
            // Шаг 3 — применяем фильтр выбросов (на временной таблице, auto-commit)
            if filter_outliers {
                let (q1, q3): (f64, f64) = conn.query_row(
                    "SELECT QUANTILE_CONT(level, 0.25), QUANTILE_CONT(level, 0.75) FROM import_temp",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                ).unwrap_or((0.0, 0.0));

                let iqr = q3 - q1;
                let lower_bound = q1 - 3.0 * iqr;
                let upper_bound = q3 + 3.0 * iqr;
                
                log_to_file(&format!("IMPORT {}: IQR filter bounds: [{:.2}, {:.2}], IQR={:.2}", 
                    filename, lower_bound, upper_bound, iqr));

                conn.execute(
                    "DELETE FROM import_temp WHERE level < ? OR level > ?",
                    params![lower_bound, upper_bound],
                ).ok();

                let after_iqr = conn.query_row(
                    "SELECT COUNT(*) FROM import_temp", [], |row| row.get(0)
                ).unwrap_or(0);
                total_filtered += raw_count - after_iqr;
                log_to_file(&format!("IMPORT {}: IQR filter removed {} outliers", 
                    filename, raw_count - after_iqr));
            }

            // Получаем финальное количество записей для вставки
            let final_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM import_temp", [], |row| row.get(0)
            ).unwrap_or(0);

            if final_count > 0 {
                if let (Some(min_ts), Some(max_ts)) = (min_ts, max_ts) {
                    // Шаг 4 — DELETE + INSERT без явной транзакции (избегаем deadlock)
                    // DuckDB auto-commit, каждая операция атомарна
                    let deleted = conn.execute(
                        "DELETE FROM sea_readings WHERE timestamp_ms BETWEEN ? AND ?",
                        params![min_ts, max_ts],
                    ).unwrap_or(0);

                    if deleted > 0 {
                        log_to_file(&format!("IMPORT: deleted {} old records in range {}..{}", 
                            deleted, min_ts, max_ts));
                    }

                    let insert_query = format!(
                        "INSERT INTO sea_readings (timestamp_ms, level, source_file)
                         SELECT timestamp_ms, level, '{}' FROM import_temp",
                        safe_name
                    );

                    match conn.execute(&insert_query, []) {
                        Ok(inserted) => {
                            count = final_count;
                            files_processed += 1;
                            total_records += count;
                            log_to_file(&format!("IMPORT BATCH OK: deleted {}, inserted {}", deleted, inserted));
                        }
                        Err(e) => {
                            log_to_file(&format!("IMPORT ERROR inserting {}: {}", filename, e));
                            let _ = conn.execute(
                                "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                                params![&e.to_string(), &filename],
                            );
                            continue;
                        }
                    }
                }
            } else {
                log_to_file(&format!("IMPORT {}: no records after filtering", filename));
                files_processed += 1;
            }
        } else {
            log_to_file(&format!("IMPORT {}: no valid records after parsing", filename));
            files_processed += 1;
        }

        // Cleanup временной таблицы
        conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();

        // Проверка: логируем реальное состояние БД
        let verify: (i64, f64, f64) = conn.query_row(
            "SELECT COUNT(*), MIN(level), MAX(level) FROM sea_readings",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap_or((0, 0.0, 0.0));
        log_to_file(&format!("IMPORT VERIFY: total={} min={:.2} max={:.2}", verify.0, verify.1, verify.2));

        // Логирование результата файла
        if filter_outliers {
            log_to_file(&format!("IMPORT FILE {}: {} raw -> {} final (outliers: {})",
                filename, raw_count, count, raw_count - count));
        } else {
            log_to_file(&format!("IMPORT FILE {}: {} records", filename, count));
        }

        let _ = conn.execute(
            "INSERT OR REPLACE INTO import_log (filename, status, records_count) VALUES (?, 'ready', ?)",
            params![&filename, count],
        );

        let elapsed = start_time.elapsed().as_secs_f32();
        let speed = if elapsed > 0.0 { (total_records as f32 / elapsed).round() } else { 0.0 };

        let outliers_in_file = if filter_outliers { raw_count - count } else { 0 };
        let status = if outliers_in_file > 0 {
            format!("{} ({} выбросов) • {:.0} записей/сек", filename, outliers_in_file, speed)
        } else {
            format!("{} • {:.0} записей/сек", filename, speed)
        };

        let _ = app.emit("import-progress", serde_json::json!({
            "progress": ((index as f32 + 1.0) / total_files as f32 * 100.0) as u8,
            "current": index + 1,
            "total": total_files,
            "filename": filename,
            "status": status,
        }));
    }

    // Оптимизация 1 (продолжение): восстанавливаем индекс после массового импорта
    if use_bulk_opt {
        log_to_file("IMPORT OPT: recreating index idx_ts");
        conn.execute("CREATE INDEX idx_ts ON sea_readings(timestamp_ms)", []).ok();
    }

    let _ = app.emit("import-progress", serde_json::json!({
        "progress": 100,
        "finished": true,
        "status": format!("Импорт завершён! {} записей", total_records)
    }));

    log_to_file(&format!("IMPORT: completed. Files: {}, Records: {}, Outliers removed: {}", 
        files_processed, total_records, total_filtered));

    Ok(serde_json::json!({
        "status": "completed",
        "files_processed": files_processed,
        "records_count": total_records,
        "outliers_removed": total_filtered,
    }))
}

#[tauri::command]
pub fn export_month_data(
    year: i32,
    month: u32,
    state: State<AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let conn = open_db(&state)?;
    
    let start_dt = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
        .ok_or("Invalid month/year")?
        .and_hms_opt(0, 0, 0)
        .ok_or("Invalid date")?;
    
    let start_ms = start_dt.and_utc().timestamp_millis();
    
    let next_month = if month == 12 {
        chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
    }.ok_or("Invalid next month").unwrap();
    
    let end_ms = next_month.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis();
    
    log_to_file(&format!("EXPORT_MONTH: {}-{:02}, range: {} to {}", year, month, start_ms, end_ms));
    
    let query = format!(
        "SELECT timestamp_ms, level FROM sea_readings 
         WHERE timestamp_ms >= {} AND timestamp_ms < {}
         ORDER BY timestamp_ms",
        start_ms, end_ms
    );
    
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    
    let rows: Vec<(i64, f64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    log_to_file(&format!("EXPORT_MONTH: Found {} records", rows.len()));
    
    if rows.is_empty() {
        return Err("No data found for this month".to_string());
    }
    
    let filename = format!("{}_{:02}.dat", year, month);
    let mut content = String::with_capacity(rows.len() * 25);
    let total_rows = rows.len();
    
    for (i, (timestamp_ms, level)) in rows.into_iter().enumerate() {
        if let Some(dt) = chrono::DateTime::from_timestamp(timestamp_ms / 1000, 0) {
            let ms = (timestamp_ms % 1000) as u32;
            let line = format!("{}.{:03} {:.6}\n", dt.format("%d.%m.%Y %H:%M:%S"), ms, level);
            content.push_str(&line);
        }

        if (total_rows > 1_000_000) && (i > 0) && (i % 1_000_000 == 0) {
            let progress = ((i as f32 / total_rows as f32) * 100.0) as u8;
            let _ = app.emit("export-progress", serde_json::json!({
                "progress": progress
            }));
        }
    }
    
    let db_path = get_db_path(&state);
    let default_path = PathBuf::from(".");
    let app_dir = db_path.parent().unwrap_or(default_path.as_path()).to_path_buf();
    let file_path = app_dir.join(&filename);
    
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    log_to_file(&format!("EXPORT_MONTH: Saved {} bytes to {:?}", content.len(), file_path));
    
    Ok(filename)
}

#[tauri::command]
pub fn get_available_years(state: State<AppState>) -> Result<Vec<i32>, String> {
    let conn = open_db(&state)?;
    
    let mut stmt = conn.prepare(
        "SELECT DISTINCT EXTRACT(YEAR FROM TO_TIMESTAMP(timestamp_ms / 1000))::INTEGER as year
         FROM sea_readings
         WHERE timestamp_ms > ?
         ORDER BY year"
    ).map_err(|e| e.to_string())?;
    
    let years = stmt
        .query_map([MIN_VALID_TS], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(years)
}
