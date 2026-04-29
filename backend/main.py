# backend/main.py
import math
import os
from datetime import datetime
from io import StringIO
from typing import Any, Dict, List, Optional, cast

import duckdb
import pandas as pd
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_PATH = "sealevel.duckdb"
DUCKDB_CONFIG = {"threads": os.cpu_count() or 4, "memory_limit": "4GB"}
MIN_VALID_TS = 946684800000  # 2000-01-01 00:00:00 UTC в миллисекундах

app = FastAPI(title="SeaLevel API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def init_db():
    conn = duckdb.connect(DB_PATH, config=DUCKDB_CONFIG)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sea_readings (
            timestamp_ms BIGINT,
            level DOUBLE,
            source_file VARCHAR
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS import_log (
            filename VARCHAR UNIQUE,
            status VARCHAR,
            records_count BIGINT,
            error_msg VARCHAR,
            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON sea_readings(timestamp_ms)")
    conn.close()


init_db()


class ImportRequest(BaseModel):
    files: List[str]


class ImportResponse(BaseModel):
    status: str
    files_processed: int
    records_count: int


class AggregateRequest(BaseModel):
    start_date: str
    end_date: str
    frequency: str


class AggregateResponse(BaseModel):
    data: List[Dict[str, Any]]
    stats: Dict[str, Any]


FREQ_DUCKDB = {
    "hour": "'hour'",
    "day": "'day'",
    "week": "'week'",
    "month": "'month'",
    "quarter": "'quarter'",
    "year": "'year'",
}


def safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        v = float(value)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


@app.get("/")
def root():
    return {"status": "ok"}


@app.post("/import", response_model=ImportResponse)
async def import_files(req: ImportRequest):
    return await run_in_threadpool(_process_import, req.files)


def _process_import(files: List[str]):
    conn = duckdb.connect(DB_PATH, config=DUCKDB_CONFIG)
    total_records = 0
    files_processed = 0

    for file_path in files:
        filename = os.path.basename(file_path)
        res = conn.execute(
            "SELECT status FROM import_log WHERE filename=?", [filename]
        ).fetchone()
        if res is not None and res[0] == "ready":
            continue

        conn.execute(
            "INSERT OR REPLACE INTO import_log (filename, status) VALUES (?, 'indexing')",
            [filename],
        )

        try:
            with open(file_path, "r", encoding="utf-8-sig") as f:
                content = f.read()

            cleaned_lines = []
            for line in content.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) >= 3:
                    cleaned_lines.append(" ".join(parts[:3]))

            if not cleaned_lines:
                conn.execute(
                    "UPDATE import_log SET status='ready', records_count=0 WHERE filename=?",
                    [filename],
                )
                continue

            csv_buffer = StringIO("\n".join(cleaned_lines))

            df: pd.DataFrame = pd.read_csv(
                csv_buffer,
                sep=r"\s+",
                header=None,
                names=["date", "time", "level"],
                dtype=str,
            )

            if df.empty:
                conn.execute(
                    "UPDATE import_log SET status='ready', records_count=0 WHERE filename=?",
                    [filename],
                )
                continue

            df["level"] = pd.to_numeric(df["level"], errors="coerce")

            raw = df["date"] + " " + df["time"]
            df["datetime"] = pd.to_datetime(
                raw, format="%d.%m.%Y %H:%M:%S.%f", errors="coerce"
            )

            mask = df["datetime"].isna()
            if bool(mask.any()):
                df.loc[mask, "datetime"] = pd.to_datetime(
                    raw[mask], format="%d.%m.%Y %H:%M:%S", errors="coerce"
                )

            if bool(df["datetime"].isna().all()):
                first_raw = raw.iloc[0] if not raw.empty else "empty"
                print(
                    f"⚠️ Could not parse ANY dates in {filename}. First raw: {first_raw}"
                )

            df = df.dropna(subset=["datetime", "level"])

            if df.empty:
                print(f"⚠️ No valid rows after parsing in {filename}")
                conn.execute(
                    "UPDATE import_log SET status='ready', records_count=0 WHERE filename=?",
                    [filename],
                )
                continue

            # 🔑 КОРРЕКТНАЯ конвертация: timestamp() возвращает секунды, умножаем на 1000 → миллисекунды
            df["timestamp_ms"] = (
                df["datetime"]
                .apply(lambda x: int(x.timestamp() * 1000))
                .astype("int64")
            )

            valid_df = cast(pd.DataFrame, df[df["timestamp_ms"] > MIN_VALID_TS])

            if valid_df.empty:
                first_ts = df["timestamp_ms"].iloc[0] if not df.empty else None
                first_dt = df["datetime"].iloc[0] if not df.empty else None
                print(
                    f"⚠️ All dates in {filename} are < 2000. First: ts={first_ts}, dt={first_dt}"
                )
                conn.execute(
                    "UPDATE import_log SET status='ready', records_count=0 WHERE filename=?",
                    [filename],
                )
                continue

            valid_df["source_file"] = filename
            cols = ["timestamp_ms", "level", "source_file"]
            insert_df = cast(pd.DataFrame, valid_df[cols].copy())
            conn.from_df(insert_df).insert_into("sea_readings")

            count = len(insert_df)
            total_records += count
            conn.execute(
                "UPDATE import_log SET status='ready', records_count=? WHERE filename=?",
                [count, filename],
            )
            files_processed += 1

        except Exception as e:
            print(f"❌ Import error for {filename}: {e}")
            import traceback

            traceback.print_exc()
            conn.execute(
                "UPDATE import_log SET status='error', error_msg=? WHERE filename=?",
                [str(e), filename],
            )

    conn.close()
    return ImportResponse(
        status="completed", files_processed=files_processed, records_count=total_records
    )


@app.post("/aggregate", response_model=AggregateResponse)
def aggregate(req: AggregateRequest):
    conn = duckdb.connect(DB_PATH, config=DUCKDB_CONFIG)

    start_ms = int(datetime.strptime(req.start_date, "%d.%m.%Y").timestamp() * 1000)
    end_ms = (
        int(datetime.strptime(req.end_date, "%d.%m.%Y").timestamp() * 1000) + 86400000
    )

    freq = req.frequency
    if freq == "decade":
        group_clause = "date_trunc('day', EPOCH_MS(timestamp_ms)) - INTERVAL '1 day' * ((datepart('day', EPOCH_MS(timestamp_ms)) - 1) % 10)"
    else:
        trunc = FREQ_DUCKDB.get(freq, "'day'")
        group_clause = f"date_trunc({trunc}, EPOCH_MS(timestamp_ms))"

    query = f"""
        SELECT {group_clause} AS dt, AVG(level) AS mean, STDDEV_SAMP(level) AS std,
               MIN(level) AS min, MAX(level) AS max, COUNT(*) AS count
        FROM sea_readings WHERE timestamp_ms BETWEEN ? AND ? GROUP BY 1 ORDER BY 1
    """

    df = conn.execute(query, [start_ms, end_ms]).df()
    conn.close()

    if df.empty:
        return AggregateResponse(data=[], stats={"count": 0, "total_records": 0})

    records: List[Dict[str, Any]] = df.to_dict(orient="records")
    data: List[Dict[str, Any]] = []
    total_records = 0

    for row in records:
        dt_val = row.get("dt")
        dt_str = pd.Timestamp(dt_val).isoformat() if dt_val is not None else ""
        count_val = int(row["count"]) if row.get("count") is not None else 0
        total_records += count_val

        data.append(
            {
                "datetime": dt_str,
                "mean": safe_float(row.get("mean")),
                "std": safe_float(row.get("std")) or 0.0,
                "min": safe_float(row.get("min")),
                "max": safe_float(row.get("max")),
                "count": count_val,
            }
        )

    return AggregateResponse(
        data=data, stats={"count": len(data), "total_records": total_records}
    )


@app.get("/import_log")
def get_import_log():
    conn = duckdb.connect(DB_PATH, config=DUCKDB_CONFIG)
    rows = conn.execute(
        "SELECT filename, status, records_count, imported_at FROM import_log ORDER BY imported_at DESC"
    ).fetchall()
    conn.close()
    return [
        {
            "filename": str(r[0]),
            "status": str(r[1]),
            "records_count": int(r[2]) if r[2] is not None else 0,
            "imported_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]


@app.get("/date_range")
def get_date_range():
    conn = duckdb.connect(DB_PATH, config=DUCKDB_CONFIG)
    res = conn.execute(
        "SELECT MIN(timestamp_ms), MAX(timestamp_ms) FROM sea_readings"
    ).fetchone()
    conn.close()

    if res is None or res[0] is None or res[0] < MIN_VALID_TS:
        return {"start": None, "end": None}

    return {
        "start": datetime.fromtimestamp(res[0] / 1000).strftime("%d.%m.%Y"),
        "end": datetime.fromtimestamp(res[1] / 1000).strftime("%d.%m.%Y")
        if res[1]
        else None,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
