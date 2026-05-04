#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор проекта SeaLevel (Tauri v2 + React + FastAPI)
Запустите: python generate_sealevel.py
"""

import os
from pathlib import Path

PROJECT_NAME = "sealevel-app"

FILES = {
    # ── Backend ──────────────────────────────────────────────────────────────
    f"{PROJECT_NAME}/backend/requirements.txt": """fastapi==0.109.0
uvicorn[standard]==0.27.0
pandas==2.2.0
pydantic==2.6.0
python-multipart==0.0.6
""",
    f"{PROJECT_NAME}/backend/main.py": """import os
import sqlite3
import pandas as pd
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal, List
import logging

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="SeaLevel Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.getcwd(), "sealevel.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute(\"\"\"
        CREATE TABLE IF NOT EXISTS sea_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_ms INTEGER NOT NULL,
            level REAL NOT NULL,
            source_file TEXT
        )
    \"\"\")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON sea_data(timestamp_ms);")
    conn.commit()
    conn.close()

@app.on_event("startup")
def startup():
    init_db()
    logging.info("DB initialized & ready")

class QueryRequest(BaseModel):
    start: str
    end: str
    resolution: Literal["hour", "day", "week", "decade", "month", "quarter", "year"]

FREQ_MAP = {
    "hour": "h", "day": "D", "week": "W-SUN", "decade": "10D",
    "month": "ME", "quarter": "QE", "year": "YE"
}

@app.post("/api/query")
def query_data(req: QueryRequest):
    try:
        start_ms = int(datetime.strptime(req.start, "%Y-%m-%d").timestamp() * 1000)
        end_ms = int(datetime.strptime(req.end, "%Y-%m-%d").replace(hour=23, minute=59, second=59).timestamp() * 1000)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date: {e}")

    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query(
        "SELECT timestamp_ms, level FROM sea_data WHERE timestamp_ms BETWEEN ? AND ? ORDER BY timestamp_ms",
        conn, params=(start_ms, end_ms)
    )
    conn.close()

    if df.empty:
        return {"data": [], "stats": {"min": 0, "max": 0, "count": 0}}

    df["timestamp"] = pd.to_datetime(df["timestamp_ms"], unit="ms")
    df.set_index("timestamp", inplace=True)

    freq = FREQ_MAP[req.resolution]
    agg = df["level"].resample(freq).agg(["mean", "std", "min", "max", "count"]).dropna()
    agg["std"] = agg["std"].fillna(0.0)

    result = agg.reset_index().rename(columns={"timestamp": "time", "mean": "mean_level", "std": "std_level"})
    result["time"] = result["time"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    stats = {"min": float(df["level"].min()), "max": float(df["level"].max()), "count": int(df["level"].count())}
    return {"data": result.to_dict(orient="records"), "stats": stats}

@app.post("/api/upload")
async def upload_files(files: List[UploadFile]):
    conn = sqlite3.connect(DB_PATH)
    total = 0
    for file in files:
        if not file.filename: continue
        try:
            content = await file.read()
            text = content.decode("utf-8")
            records = []
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#"): continue
                parts = line.split()
                if len(parts) < 3: continue
                try:
                    dt = datetime.strptime(f"{parts[0]} {parts[1]}", "%d.%m.%Y %H:%M:%S.%f")
                    ts_ms = int(dt.timestamp() * 1000)
                    level = float(parts[2])
                    records.append((ts_ms, level, file.filename))
                except (ValueError, IndexError):
                    continue
            if records:
                conn.executemany("INSERT INTO sea_data (timestamp_ms, level, source_file) VALUES (?, ?, ?)", records)
                total += len(records)
        except Exception as e:
            logging.error(f"Failed {file.filename}: {e}")
    conn.commit()
    conn.close()
    return {"status": "ok", "imported": total}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
""",

    # ── Frontend Configs ─────────────────────────────────────────────────────
    f"{PROJECT_NAME}/frontend/package.json": """{
  "name": "sealevel-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0",
    "recharts": "^2.10.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.2.2",
    "vite": "^5.0.8"
  }
}
""",
    f"{PROJECT_NAME}/frontend/tsconfig.json": """{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
""",
    f"{PROJECT_NAME}/frontend/tsconfig.node.json": """{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
""",
    f"{PROJECT_NAME}/frontend/vite.config.ts": """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true
  }
})
""",
    f"{PROJECT_NAME}/frontend/index.html": """<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SeaLevel</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""",

    # ── Frontend Source ──────────────────────────────────────────────────────
    f"{PROJECT_NAME}/frontend/src/main.tsx": """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
""",
    f"{PROJECT_NAME}/frontend/src/vite-env.d.ts": """/// <reference types="vite/client" />
""",
    f"{PROJECT_NAME}/frontend/src/index.css": """body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f5f7fa; color: #111; }
#root { min-height: 100vh; display: flex; flex-direction: column; }
button { cursor: pointer; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
""",
    f"{PROJECT_NAME}/frontend/src/store/useStore.ts": """import { create } from 'zustand';

export interface AggregatedPoint {
  time: string;
  mean_level: number;
  std_level: number;
  min: number;
  max: number;
}

interface AppState {
  startDate: string;
  endDate: string;
  resolution: 'hour' | 'day' | 'week' | 'decade' | 'month' | 'quarter' | 'year';
  data: AggregatedPoint[];
  loading: boolean;
  error: string | null;
  stats: { min: number; max: number; count: number } | null;
  setDates: (start: string, end: string) => void;
  setResolution: (res: AppState['resolution']) => void;
  loadData: () => Promise<void>;
}

const now = new Date();
const defEnd = now.toISOString().split('T')[0];
const defStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString().split('T')[0];

export const useStore = create<AppState>((set, get) => ({
  startDate: defStart,
  endDate: defEnd,
  resolution: 'month',
  data: [],
  loading: false,
  error: null,
  stats: null,
  setDates: (start, end) => set({ startDate: start, endDate: end }),
  setResolution: (res) => set({ resolution: res }),
  loadData: async () => {
    set({ loading: true, error: null });
    const { startDate, endDate, resolution } = get();
    const port = 8000;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startDate, end: endDate, resolution }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      set({ data: json.data, stats: json.stats, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  }
}));
""",
    f"{PROJECT_NAME}/frontend/src/components/SeaLevelChart.tsx": """import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AggregatedPoint } from '../store/useStore';

export const SeaLevelChart = ({ data }: { data: AggregatedPoint[] }) => (
  <ResponsiveContainer width="100%" height={350}>
    <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
      <XAxis dataKey="time" tickFormatter={(v) => v.slice(0, 10)} />
      <YAxis domain={['auto', 'auto']} />
      <Tooltip formatter={(v: number) => v.toFixed(2)} />
      <Legend />
      <Area type="monotone" dataKey={(d: any) => d.mean_level + d.std_level}
            stroke="none" fill="#8884d8" fillOpacity={0.15} isAnimationActive={false} />
      <Area type="monotone" dataKey={(d: any) => d.mean_level - d.std_level}
            stroke="none" fill="#ffffff" fillOpacity={1} isAnimationActive={false} />
      <Area type="monotone" dataKey="mean_level" stroke="#8884d8" fill="none" strokeWidth={2} name="Среднее" />
    </AreaChart>
  </ResponsiveContainer>
);
""",
    f"{PROJECT_NAME}/frontend/src/App.tsx": """import { useState } from 'react';
import { useStore } from './store/useStore';
import { SeaLevelChart } from './components/SeaLevelChart';

const RES_OPTIONS = ['hour','day','week','decade','month','quarter','year'] as const;

export default function App() {
  const { startDate, endDate, resolution, data, loading, error, stats, setDates, setResolution, loadData } = useStore();
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(e.target.files).forEach(f => fd.append('files', f));
    try {
      await fetch('http://127.0.0.1:8000/api/upload', { method: 'POST', body: fd });
      alert('✅ Файлы загружены. Нажмите "Рассчитать" для визуализации.');
    } catch { alert('❌ Ошибка загрузки'); }
    setUploading(false);
    e.target.value = '';
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', flex: 1 }}>
      <h1 style={{ marginBottom: '1.5rem' }}>🌊 SeaLevel</h1>

      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem', padding: '1rem', background: '#f8f9fa', borderRadius: 8 }}>
        <input type="file" multiple accept=".dat" onChange={handleUpload} disabled={uploading} style={{ flex: 1, padding: '0.4rem' }} />
        <label>от</label> <input type="date" value={startDate} onChange={e => setDates(e.target.value, endDate)} />
        <label>до</label> <input type="date" value={endDate} onChange={e => setDates(startDate, e.target.value)} />
        <select value={resolution} onChange={e => setResolution(e.target.value as any)} style={{ padding: '0.4rem' }}>
          {RES_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={loadData} disabled={loading || data.length === 0 && !loading} style={{ padding: '0.5rem 1rem', background: '#0055cc', color: '#fff', border: 'none', borderRadius: 4 }}>
          {loading ? '⏳ Загрузка...' : '📊 Рассчитать'}
        </button>
      </div>

      {error && <p style={{ color: '#d32f2f', marginBottom: '1rem' }}>{error}</p>}
      {stats && <p style={{ fontSize: '0.9rem', color: '#555', marginBottom: '0.5rem' }}>
        Точек в диапазоне: {stats.count} | Мин: {stats.min.toFixed(2)} | Макс: {stats.max.toFixed(2)}
      </p>}

      <SeaLevelChart data={data} />
      <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.5rem' }}>
        * Данные осреднены по выбранной дискретности. Полупрозрачная область = ±1σ.
      </p>
    </div>
  );
}
""",

    # ── Tauri v2 ─────────────────────────────────────────────────────────────
    f"{PROJECT_NAME}/src-tauri/Cargo.toml": """[package]
name = "sealevel"
version = "0.1.0"
description = "SeaLevel Desktop App"
authors = ["You"]
license = "MIT"
repository = ""
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0.0-beta", features = [] }

[dependencies]
tauri = { version = "2.0.0-beta", features = [] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[features]
custom-protocol = ["tauri/custom-protocol"]
""",
    f"{PROJECT_NAME}/src-tauri/tauri.conf.json": """{
  "productName": "sealevel",
  "version": "0.1.0",
  "identifier": "com.sealevel.app",
  "build": {
    "beforeDevCommand": "npm run dev --prefix ../frontend",
    "beforeBuildCommand": "npm run build --prefix ../frontend",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../frontend/dist"
  },
  "app": {
    "windows": [{ "title": "SeaLevel", "width": 1379, "height": 900 }],
    "security": { "csp": "default-src 'self'; connect-src http://localhost:* http://127.0.0.1:*" }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["../binaries/sealevel_api"],
    "icon": ["icons/icon.png"]
  }
}
""",
    f"{PROJECT_NAME}/src-tauri/build.rs": """fn main() {
    tauri_build::build()
}
""",
    f"{PROJECT_NAME}/src-tauri/src/main.rs": """#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
""",
}

def create_project():
    root = Path(PROJECT_NAME)
    if root.exists():
        print(f"⚠️ Папка '{root}' уже существует. Очистите её или удалите перед запуском.")
        return

    for rel_path, content in FILES.items():
        full_path = root / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")

    (root / "src-tauri" / "icons").mkdir(parents=True, exist_ok=True)

    print(f"✅ Проект успешно создан в папке: {root}/")
    print("📦 Дальнейшие шаги:")
    print("   1. cd sealevel-app")
    print("   2. cd backend && python -m venv .venv")
    print("      🪟 Windows: .venv\\Scripts\\activate")
    print("      🐧 Linux/macOS: source .venv/bin/activate")
    print("   3. pip install -r requirements.txt")
    print("   4. cd ../frontend && npm install")
    print("   5. В корне проекта: npm install -D @tauri-apps/cli")
    print("   6. Запуск: npx tauri dev")

if __name__ == "__main__":
    create_project()
