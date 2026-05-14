# SeaLevel — Руководство разработчика

Приложение для анализа данных уровня моря с визуализацией временных рядов.

---

## 📋 Содержание

1. [Обзор архитектуры](#обзор-архитектуры)
2. [Технологический стек](#технологический-стек)
3. [Структура проекта](#структура-проекта)
4. [База данных](#база-данных)
5. [API](#api)
6. [Запуск и разработка](#запуск-и-разработка)
7. [Сборка релиза](#сборка-релиза)
8. [Ключевые компоненты](#ключевые-компоненты)
9. [Оптимизации](#оптимизации)
10. [Логирование и отладка](#логирование-и-отладка)
11. [Расширение функциональности](#расширение-функциональности)

---

## Обзор архитектуры

```text
┌─────────────────────────────────────────────────────────────────┐
│                     SeaLevel Desktop App                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Frontend   │    │   Tauri      │    │   Backend    │      │
│  │   (React)    │◄──►│   (Rust)     │◄──►│   (Python)   │      │
│  │              │    │   Runtime    │    │   (FastAPI)  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         │                   │                   ▼               │
│         │                   │          ┌──────────────┐        │
│         │                   └─────────►│   DuckDB     │        │
│         │                              │   (Embedded) │        │
│         ▼                              └──────────────┘        │
│  ┌──────────────┐                                               │
│  │   uPlot      │                                               │
│  │   (Chart)    │                                               │
│  └──────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Режимы работы:**

| Режим | Frontend | Backend | БД |
|-------|----------|---------|-----|
| **Dev** | Vite dev server (5173) | Python FastAPI (8000) | `backend/sealevel.duckdb` |
| **Prod** | Встроено в Tauri | Rust (встроенный) | `sealevel.duckdb` в папке приложения |

---

## Технологический стек

### Frontend

| Технология | Версия | Назначение |
|------------|--------|------------|
| React | 18.3.1 | UI фреймворк |
| TypeScript | 5.6.2 | Типизация |
| Vite | 6.0.1 | Сборщик |
| Zustand | 5.0.12 | State management |
| uPlot | 1.6.32 | Визуализация графиков |
| Recharts | 3.8.1 | Дополнительные графики |
| Tauri API | 2.x | Нативные вызовы |

### Backend (Dev)

| Технология | Версия | Назначение |
|------------|--------|------------|
| Python | 3.11.9 | Язык |
| FastAPI | 0.136.1 | REST API |
| Uvicorn | 0.46.0 | ASGI сервер |
| DuckDB | 1.5.2 | Встроенная БД |
| Pandas | 3.0.2 | Обработка данных |
| Pydantic | 2.13.3 | Валидация |

### Backend (Prod / Tauri)

| Технология | Версия | Назначение |
|------------|--------|------------|
| Rust | 1.77.2+ | Язык |
| Tauri | 2.x | Desktop runtime |
| duckdb-rs | 1.x | Встроенная БД |
| serde | 1.0 | Сериализация |
| chrono | 0.4 | Дата/время |
| lru | 0.12 | LRU кэш |

---

## Структура проекта

```text
SeaLevel/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   # Главный компонент
│   ├── store.ts                  # Zustand store
│   ├── api.ts                    # API client (Tauri invoke / HTTP)
│   ├── components/
│   │   ├── ChartSection.tsx      # Секция графика
│   │   ├── ControlsSection.tsx   # Панель управления
│   │   ├── ActionButtonsSection.tsx  # Кнопки действий
│   │   ├── SeaLevelUPlot.tsx     # uPlot компонент
│   │   ├── FilesModal.tsx        # Модальное окно файлов
│   │   └── ImportModal.tsx       # Модальное окно импорта
│   ├── index.css                 # Стили
│   └── main.tsx                  # Entry point
│
├── src-tauri/                    # Tauri (Rust)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri setup
│   │   └── backend.rs            # Бизнес-логика (DB, API handlers)
│   ├── Cargo.toml                # Rust зависимости
│   └── tauri.conf.json           # Tauri конфиг
│
├── backend/                      # Python backend (dev режим)
│   ├── main.py                   # FastAPI приложение
│   ├── run_server.py             # Скрипт запуска
│   ├── requirements.txt          # Python зависимости
│   └── test_*.py                 # Тесты
│
├── docs/                         # Документация
│   ├── DEVELOPER_GUIDE.md        # Это руководство
│   └── FILTER.md                 # Описание фильтрации
│
├── public/                       # Статические файлы
├── dist/                         # Собранный frontend (генерируется)
├── release/                      # Релизная сборка (генерируется)
│
├── package.json                  # Node.js зависимости
├── vite.config.ts                # Vite конфигурация
├── tsconfig.json                 # TypeScript конфиг
├── build.py                      # Скрипт сборки релиза
├── launcher.py                   # Лаунчер для prod версии
├── dev.bat                       # Запуск dev режима (Windows)
├── start.bat                     # Запуск приложения
└── sealevel.duckdb               # База данных (генерируется)
```

---

## База данных

### Схема

**Таблица `sea_readings`**

```sql
CREATE TABLE sea_readings (
    timestamp_ms BIGINT,      -- Unix timestamp в миллисекундах
    level DOUBLE,             -- Уровень моря (мм)
    source_file VARCHAR       -- Имя файла-источника
);

CREATE INDEX idx_ts ON sea_readings(timestamp_ms);
```

**Таблица `import_log`**

```sql
```sql
CREATE TABLE import_log (
    filename VARCHAR UNIQUE,
    status VARCHAR,           -- 'queued', 'indexing', 'ready', 'error'
    records_count BIGINT,
    error_msg VARCHAR,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Формат импортируемых файлов

Исходные файлы должны иметь формат:

```text
dd.mm.yyyy HH:MM:SS.fff level_value
```

Пример:

```text
01.01.2020 00:00:00.000 -1234.567
01.01.2020 00:01:00.000 -1235.123
```

### Расположение БД

| Режим | Путь |
|-------|------|
| Dev | `backend/sealevel.duckdb` |
| Prod | `<app_dir>/sealevel.duckdb` |

---

## API

### REST Endpoints (Dev режим)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/` | Health check |
| POST | `/import` | Импорт файлов |
| POST | `/aggregate` | Агрегация данных |
| POST | `/export_full` | Полный экспорт |
| GET | `/import_log` | Журнал импорта |
| GET | `/date_range` | Диапазон дат |
| POST | `/clear_cache` | Очистка кэша |

### Tauri Commands (Prod режим)

| Команда | Параметры | Описание |
|---------|-----------|----------|
| `import_files` | `payload: ImportPayload` | Импорт файлов |
| `aggregate` | `startDate, endDate, freq` | Агрегация |
| `export_full_data` | `startDate, endDate, freq` | Экспорт |
| `export_month_data` | `year, month` | Экспорт месяца |
| `get_import_log` | — | Журнал импорта |
| `get_date_range` | — | Диапазон дат |
| `get_available_years` | — | Доступные годы |
| `clear_aggregate_cache` | — | Очистка кэша |
| `init_db` | — | Инициализация БД |

### Форматы запросов/ответов

**ImportRequest**

```json
{
  "files": ["/path/to/file1.dat", "/path/to/file2.dat"],
  "filterOutliers": true,
  "halfWindow": 50,
  "k": 3.0
}
```

**AggregateRequest**

```json
{
  "start_date": "2020-01-01",
  "end_date": "2025-12-31",
  "frequency": "day"
}
```

**AggregateResponse**

```json
{
  "data": [
    {
      "datetime": "2020-01-01T00:00:00",
      "timestamp": 1577836800000,
      "mean": -1234.56,
      "std": 12.34,
      "min": -1250.00,
      "max": -1220.00,
      "count": 1440
    }
  ],
  "stats": {
    "count": 2191,
    "total_records": 3155040
  }
}
```

### Поддерживаемые частоты агрегации

| Частота | Описание |
|---------|----------|
| `second` | По секундам |
| `10min` | 10-минутные интервалы |
| `hour` | По часам |
| `day` | По дням |
| `week` | По неделям |
| `month` | По месяцам |
| `quarter` | По кварталам |
| `year` | По годам |
| `decade` | Декады (1-10, 11-20, 21-конец месяца) |

---

## Запуск и разработка

### Требования

- **Node.js** 18+
- **Python** 3.11.9
- **Rust** 1.77.2+
- **Git**

### Установка зависимостей

```bash
# Frontend
npm install

# Backend (Python)
cd backend
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

### Запуск в режиме разработки

**Windows (dev.bat):**

```batch
@echo off
echo Starting SeaLevel API...
start "SeaLevel API" cmd /k "cd /d N:\Development\SeaLevel\backend && .venv\Scripts\python.exe main.py"
echo Starting Frontend...
start cmd /k "cd /d N:\Development\SeaLevel && npm run dev"
```

**Вручную:**

```bash
# Терминал 1: Backend
cd backend
.venv\Scripts\python.exe main.py

# Терминал 2: Frontend
npm run dev
```

Frontend: http://localhost:5173
Backend API: http://127.0.0.1:8000

### Запуск Tauri dev

```bash
npm run tauri dev
```

---

## Сборка релиза

### Шаги сборки

1. **Собрать frontend:**

   ```bash
   npm run build
   ```

2. **Собрать релизную папку:**

   ```bash
   python build.py
   ```

3. **Собрать Tauri приложение (опционально):**

   ```bash
   npm run tauri build
   ```

### Структура release/

```text
release/
├── backend/
│   ├── main.py
│   ├── run_server.py
│   └── requirements.txt
├── dist/                    # Собранный frontend
├── sealevel.duckdb          # База данных
├── launcher.py              # Лаунчер
└── start.bat                # Скрипт запуска
```

### Запуск релизной версии

```bash
cd release
python launcher.py
```

Или использовать `start.bat`.

---

## Ключевые компоненты

### Frontend

#### `src/App.tsx`

Главный компонент приложения:

- Управление состоянием через Zustand
- Обработка событий импорта
- Координация между компонентами
- Быстрый зум (периоды: весь, 30д, 7д, 1д)

#### `src/store.ts`

Zustand store с состоянием:

- `importFiles` — список импортированных файлов
- `aggregateData` — агрегированные данные для графика
- `dateRange` — диапазон дат в БД
- `startDate`, `endDate`, `frequency` — параметры расчёта
- `isLoading`, `isImporting` — флаги загрузки
- `error` — сообщения об ошибках

#### `src/api.ts`

API клиент с автоматическим переключением:

- **Dev режим:** HTTP запросы к FastAPI
- **Prod режим:** Tauri `invoke()` команды

#### `src/components/SeaLevelUPlot.tsx`

Компонент графика на uPlot:

- LOD (Level of Detail) — downsample при >5000 точек
- Зум и панорамирование
- Многострочный формат дат
- Отображение разрывов (null значения)

### Backend (Rust)

#### `src-tauri/src/backend.rs`

Основная бизнес-логика:

**Ключевые функции:**

- `import_files()` — импорт с фильтрацией выбросов
- `aggregate()` — агрегация данных с кэшированием
- `export_full_data()` — полный экспорт
- `export_month_data()` — экспорт месяца в .dat
- `add_gap_points()` — заполнение разрывов null-точками
- `downsample_points()` — уменьшение точек для графика

**Оптимизации:**

- LRU кэш запросов (100 записей)
- Удаление индекса при массовом импорте
- Пакетная вставка записей
- Параллельные вычисления DuckDB

### Backend (Python)

#### `backend/main.py`

FastAPI приложение (dev режим):

- Полная копия логики Rust backend
- CORS для localhost:5173
- Асинхронные endpoint'ы

---

## Оптимизации

### Frontend

| Оптимизация | Описание |
|-------------|----------|
| **LOD графиков** | Downsample до 5000 точек для uPlot |
| **React.memo** | Избежание лишних re-render |
| **Code splitting** | Разделение vendor чанков |
| **Brotli сжатие** | Сжатие ассетов в production |
| **Lazy loading** | Загрузка диалогов по требованию |

### Backend (Rust)

| Оптимизация | Описание |
|-------------|----------|
| **LRU кэш** | Кэширование aggregate запросов (100 записей) |
| **Bulk import** | Удаление индекса при массовом импорте |
| **Параллелизм DuckDB** | 16 потоков, 4GB памяти |
| **Batch INSERT** | Пакетная вставка до 1M записей |
| **Временные таблицы** | Изоляция импорта от основных данных |

### Backend (Python)

| Оптимизация | Описание |
|-------------|----------|
| **Thread pool** | Запуск в threadpool для async |
| **Pandas векторизация** | Быстрая обработка CSV |
| **DuckDB конфиг** | Многопоточность и лимиты памяти |

---

## Логирование и отладка

### Лог-файлы

| Файл | Расположение |
|------|--------------|
| **App log** | `<app_dir>/sealevel.log` |
| **Console** | Browser DevTools (F12) |

### Формат логов

```text
[HH:MM:SS.mmm] MESSAGE
```

Пример:

```text
[14:23:45.123] [SeaLevel] STARTING...
[14:23:45.456] [SeaLevel] DB: C:\App\sealevel.duckdb
[14:23:46.789] AGGREGATE freq=day, query starts with: SELECT...
[14:23:47.012] AGGREGATE SUCCESS: 2191 points for freq=day
```

### Отладка frontend

```bash
# Включить sourcemaps (vite.config.ts)
build: {
  sourcemap: true
}
```

Открыть DevTools (F12) → Console / Network.

### Отладка backend

**Python:**

```bash
# Запуск с verbose логами
python -u backend/main.py
```

**Rust:**

```bash
# Запуск с логами
npm run tauri dev -- --verbose
```

---

## Расширение функциональности

### Добавление нового API endpoint

#### 1. Rust backend (`src-tauri/src/backend.rs`)

```rust
#[tauri::command]
pub fn my_new_command(
    param1: String,
    param2: i32,
    state: State<AppState>,
) -> Result<String, String> {
    let conn = open_db(&state)?;
    // Логика...
    Ok("result".to_string())
}
```

#### 2. Регистрация в `src-tauri/src/lib.rs`

```rust
.invoke_handler(tauri::generate_handler![
    // ... существующие
    my_new_command,  // Добавить сюда
])
```

#### 3. Frontend API client (`src/api.ts`)

```typescript
export async function myNewCommand(
  param1: string,
  param2: number
): Promise<string> {
  if (isDev) {
    const response = await httpFetch('/my_new_command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ param1, param2 }),
    })
    return response.json()
  }

  return await invoke('my_new_command', { param1, param2 })
}
```

#### 4. Python backend (dev режим, `backend/main.py`)

```python
@app.post("/my_new_command")
def my_new_command(req: MyRequest):
    # Логика...
    return {"result": "ok"}
```

### Добавление новой частоты агрегации

#### 1. Rust backend

В `get_group_expr()`:

```rust
"new_freq" => "epoch_ms(date_trunc('new_freq', EPOCH_MS(timestamp_ms)))".to_string(),
```

В `get_interval_ms()`:

```rust
"new_freq" => INTERVAL_IN_MS,
```

#### 2. Python backend

В `FREQ_DUCKDB`:

```python
"new_freq": "'new_freq'",
```

В `FREQ_INTERVAL_MS`:

```python
"new_freq": INTERVAL_IN_MS,
```

#### 3. Frontend

Добавить опцию в `ControlsSection.tsx`:

```tsx
<option value="new_freq">Новая частота</option>
```

### Изменение параметров фильтрации

Параметры в `src/App.tsx`:

```typescript
await importFilesApi(
  files,
  500,    // halfWindow — размер окна (±50 = 101 точка)
  3.0,    // k — множитель MAD
  useIqrFilter  // IQR фильтр
)
```

---

## Производительность

### benchmarks

| Операция | Данные | Время |
|----------|--------|-------|
| Импорт 1 файла | 46M записей | ~120 сек |
| Импорт (bulk) | 100M записей | ~200 сек |
| Агрегация (day) | 100M записей | ~2 сек |
| Агрегация (hour) | 100M записей | ~3 сек |
| Экспорт месяца | 4.5M записей | ~5 сек |

### Рекомендации

1. **Массовый импорт:** Используйте bulk оптимизацию (>1 файла)
2. **Большие диапазоны:** Выбирайте крупную частоту (month, year)
3. **График:** LOD автоматически уменьшает точки до 5000
4. **Кэш:** Агрегаты кэшируются — повторные запросы мгновенные

---

## Troubleshooting

### Ошибка: "Port 8000 already in use"

```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Или изменить порт в backend/main.py
uvicorn.run(app, host="127.0.0.1", port=8001)
```

### Ошибка: "Database locked"

Закрыть все экземпляры приложения. DuckDB не поддерживает множественную запись.

### Ошибка: "Module not found" (frontend)

```bash
npm install
rm -rf node_modules
npm install
```

### Ошибка: "Python not found"

Установить Python 3.11.9 и добавить в PATH.

### Ошибка импорта: "No valid records"

Проверить формат файла:

- Разделитель: пробел
- Формат даты: `dd.mm.yyyy HH:MM:SS.fff`
- Кодировка: UTF-8 или UTF-8-BOM

---

## Контакты

- **Репозиторий:** [указать при наличии]
- **Документация:** `docs/`
- **Логи:** `sealevel.log`

---

*Последнее обновление: 2025*
