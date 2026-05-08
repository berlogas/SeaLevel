use duckdb::{Connection, params, Error as DbError, Row};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{State, Window, Emitter};

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
    Connection::open(&path).map_err(|e| e.to_string())
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

// ==================== GAP LOGIC (20 минут) ====================
fn add_gap_points(data: &[DataPoint], interval_ms: i64, freq: &str) -> Vec<DataPoint> {
    if data.is_empty() {
        log_to_file("add_gap_points: empty data");
        return vec![];
    }

    let gap_threshold = match freq {
        "second" => 10_000i64,        // разрыв линии при пропуске > 10 секунд
        "10min" => 20 * 60_000i64,     // разрыв линии при пропуске > 20 минут
        _       => (interval_ms as f64 * 1.5) as i64,
    };

    let max_gap_to_fill = match freq {
        "second" => 60_000i64,         // до 1 минуты - вставляем null для разрыва линии
        "10min" => 3 * 24 * 60 * 60_000i64,     // до 3 дней - вставляем null для разрыва линии
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

// ==================== КОМАНДЫ ====================

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

    log_to_file(&format!("AGGREGATE SUCCESS: {} points for freq={}", rows.len(), freq));

    let with_gaps = add_gap_points(&rows, interval_ms, &freq);
    let nulls_before = with_gaps.iter().filter(|p| p.mean.is_none()).count();
    
    // Для часов и более крупных агрегаций не downsampling (мало точек)
    let max_points = match freq.as_str() {
        "second" | "10min" => MAX_CHART_POINTS,  // Много данных - downsampling нужен
        _ => with_gaps.len(),                    // Мало данных - без downsampling
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

#[tauri::command]
pub fn import_files(
    files: Vec<String>,
    filter_outliers: bool,
    _half_window: usize,
    k: f64,
    state: State<AppState>,
    window: Window,
) -> Result<serde_json::Value, String> {
    let _iqr_multiplier = k; // Множитель IQR для фильтра
    log_to_file(&format!("=== IMPORT START: {} files, filter={}, k={} ===", 
        files.len(), filter_outliers, k));
    let conn = open_db(&state)?;
    
    let total_files = files.len();
    let mut total_records = 0i64;
    let mut total_filtered = 0i64;
    let mut files_processed = 0i32;
    let start_time = std::time::Instant::now();

    for (index, file_path) in files.iter().enumerate() {
        let filename = std::path::PathBuf::from(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let _ = window.emit("import-progress", serde_json::json!({
            "progress": ((index as f32 / total_files as f32) * 100.0) as u8,
            "current": index + 1,
            "total": total_files,
            "filename": filename,
            "status": "Чтение файла..."
        }));

        let safe_path = file_path.replace("'", "''");
        let safe_name = filename.replace("'", "''");

        // Шаг 1: Читаем файл во временную таблицу
        let read_query = format!(
            "CREATE TABLE IF NOT EXISTS import_temp AS
             SELECT CAST(epoch_ms(strptime(col0 || ' ' || col1, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT) as timestamp_ms,
                    col2::DOUBLE as level
             FROM read_csv('{}', header=false, sep=' ', auto_detect=false, sample_size=-1,
                 columns={{'col0': 'VARCHAR', 'col1': 'VARCHAR', 'col2': 'DOUBLE'}})
             WHERE col0 IS NOT NULL AND col0 != '' AND col2 IS NOT NULL
               AND CAST(epoch_ms(strptime(col0 || ' ' || col1, '%d.%m.%Y %H:%M:%S.%f')) AS BIGINT) > {}",
            safe_path, MIN_VALID_TS
        );

        conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();
        
        if let Err(e) = conn.execute(&read_query, []) {
            log_to_file(&format!("IMPORT ERROR reading {}: {}", filename, e));
            let _ = conn.execute(
                "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                params![&e.to_string(), &filename],
            );
            continue;
        }

        // Шаг 2: Определяем диапазон дат файла
        let (min_ts, max_ts): (i64, i64) = {
            let result: Result<(Option<i64>, Option<i64>), _> = conn.query_row(
                "SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM import_temp",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            );
            
            match result {
                Ok((Some(min), Some(max))) => (min, max),
                _ => {
                    // Пустой файл
                    conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();
                    continue;
                }
            }
        };

        // Шаг 3: Удаляем старые данные в этом диапазоне
        let deleted_old: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sea_readings WHERE timestamp_ms BETWEEN ? AND ?",
            params![min_ts, max_ts],
            |row| row.get(0),
        ).unwrap_or(0);

        conn.execute(
            "DELETE FROM sea_readings WHERE timestamp_ms BETWEEN ? AND ?",
            params![min_ts, max_ts],
        ).ok();

        if deleted_old > 0 {
            log_to_file(&format!("IMPORT {}: deleted {} old records from DB (same date range)", 
                filename, deleted_old));
        }

        // Запоминаем количество записей в файле ДО фильтрации
        let raw_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM import_temp",
            [],
            |row: &Row| row.get(0),
        ).unwrap_or(0);
        
        // Шаг 4: Фильтрация выбросов
        if filter_outliers {
            // Проверим диапазон значений в файле
            let (min_level, max_level, avg_level, q1, q3): (f64, f64, f64, f64, f64) = conn.query_row(
                "SELECT MIN(level), MAX(level), AVG(level), 
                        QUANTILE_CONT(level, 0.25), QUANTILE_CONT(level, 0.75) 
                 FROM import_temp",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).unwrap_or((0.0, 0.0, 0.0, 0.0, 0.0));
            
            log_to_file(&format!("IMPORT {}: levels min={:.2}, max={:.2}, avg={:.2}, Q1={:.2}, Q3={:.2}", 
                filename, min_level, max_level, avg_level, q1, q3));

            // IQR-based фильтр
            let iqr = q3 - q1;
            let lower_bound = q1 - 3.0 * iqr;
            let upper_bound = q3 + 3.0 * iqr;
            
            log_to_file(&format!("IMPORT {}: IQR filter bounds: [{:.2}, {:.2}], IQR={:.2}", 
                filename, lower_bound, upper_bound, iqr));

            // Удаляем выбросы по IQR
            conn.execute(
                "DELETE FROM import_temp WHERE level < ? OR level > ?",
                params![lower_bound, upper_bound],
            ).ok();

            let after_iqr_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM import_temp", [], |row| row.get(0)
            ).unwrap_or(0);
            let removed_by_iqr = raw_count - after_iqr_count;
            log_to_file(&format!("IMPORT {}: IQR filter removed {} outliers", 
                filename, removed_by_iqr));

            // Вставляем отфильтрованные данные
            let insert_query = format!(
                "INSERT INTO sea_readings (timestamp_ms, level, source_file) 
                 SELECT timestamp_ms, level, '{}' FROM import_temp",
                safe_name
            );

            if let Err(e) = conn.execute(&insert_query, []) {
                log_to_file(&format!("IMPORT ERROR inserting {}: {}", filename, e));
                let _ = conn.execute(
                    "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                    params![&e.to_string(), &filename],
                );
                conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();
                continue;
            }

            let final_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sea_readings WHERE source_file = ?",
                params![&filename],
                |row| row.get(0),
            ).unwrap_or(0);
            
            total_filtered += raw_count - final_count;
            log_to_file(&format!("IMPORT {}: {} -> {} (total removed: {})", 
                filename, raw_count, final_count, raw_count - final_count));
        } else {
            let insert_query = format!(
                "INSERT INTO sea_readings (timestamp_ms, level, source_file) SELECT timestamp_ms, level, '{}' FROM import_temp",
                safe_name
            );

            if let Err(e) = conn.execute(&insert_query, []) {
                log_to_file(&format!("IMPORT ERROR inserting {}: {}", filename, e));
                let _ = conn.execute(
                    "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                    params![&e.to_string(), &filename],
                );
                conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();
                continue;
            }
        }
        
        let _ = conn.execute("DROP TABLE IF EXISTS import_temp", []).ok();

        // Подсчитываем результаты
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sea_readings WHERE source_file = ?",
            params![&filename],
            |row: &Row| row.get(0),
        ).unwrap_or(0);

        files_processed += 1;
        total_records += count;

        // Считаем отфильтрованные выбросы
        if filter_outliers {
            let outliers = raw_count - count;
            total_filtered += outliers;
            log_to_file(&format!("IMPORT FILE {}: {} records -> {} (outliers: {})", 
                filename, raw_count, count, outliers));
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

        let _ = window.emit("import-progress", serde_json::json!({
            "progress": ((index as f32 + 1.0) / total_files as f32 * 100.0) as u8,
            "current": index + 1,
            "total": total_files,
            "filename": filename,
            "status": status,
        }));
    }

    let _ = conn.execute("DELETE FROM aggregates", []);

    let _ = window.emit("import-progress", serde_json::json!({
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

