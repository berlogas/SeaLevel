import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend } from 'recharts'
import { useStore } from './store'
import { importFiles as importFilesApi, aggregate, getImportLog, getDateRange } from './api'

const FREQUENCIES = [
  { value: 'hour', label: 'Час' },
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'decade', label: 'Декада' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
]

function App() {
  const {
    setImportFiles,
    importFiles,
    isImporting,
    setIsImporting,
    importProgress,
    setImportProgress,
    importStatus,
    setImportStatus,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    frequency,
    setFrequency,
    aggregateData,
    setAggregateData,
    isLoading,
    setIsLoading,
    dateRange,
    setDateRange,
    error,
    setError,
  } = useStore()

  const [calcTime, setCalcTime] = useState(0)

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    try {
      const log = await getImportLog()
      setImportFiles(log)
      const range = await getDateRange()
      setDateRange(range)
      if (range.start) setStartDate(range.start)
      if (range.end) setEndDate(range.end)
    } catch (e) {
      console.error('Failed to load initial data:', e)
    }
  }

  const handleImport = async () => {
    try {
      let selected: any = null
      let dialogLib: any = null
      try {
        dialogLib = await import('@tauri-apps/plugin-dialog')
      } catch (e) {
        setError('Cannot load dialog: ' + String(e))
        return
      }
      
      if (!dialogLib || typeof dialogLib.open !== 'function') {
        setError('Dialog.open not found')
        return
      }
      
      setIsImporting(true)
      setImportProgress(10)
      setImportStatus('Открытие диалога...')
      
      try {
        selected = await dialogLib.open({
          multiple: true,
          filters: [{ name: 'Data Files', extensions: ['dat'] }],
        })
      } catch {
        setIsImporting(false)
        setImportProgress(0)
        setImportStatus('')
        setError('Диалог отменен')
        return
      }
      
      if (!selected) {
        setIsImporting(false)
        setImportProgress(0)
        setImportStatus('')
        return
      }

      const files = Array.isArray(selected) ? selected : [selected]
      if (files.length === 0) {
        setIsImporting(false)
        setImportProgress(0)
        setImportStatus('')
        return
      }
      
      setImportProgress(20)
      setImportStatus(`Выбрано файлов: ${files.length}`)
      setError(null)

      try {
        setImportProgress(30)
        setImportStatus('Импорт... (может занять несколько минут)')
        
        const result = await importFilesApi(files)
        setImportProgress(90)
        
        if (result.files_processed > 0) {
          const log = await getImportLog()
          setImportFiles(log)

          const range = await getDateRange()
          setDateRange(range)
          if (range.start) setStartDate(range.start)
          if (range.end) setEndDate(range.end)
          
          setImportStatus(`Готово! Записей: ${result.records_count}`)
        } else {
          setError('Файлы не найдены или пустые')
        }
        
        setTimeout(() => {
          setIsImporting(false)
          setImportProgress(0)
          setImportStatus('')
        }, 2000)
        
      } catch (apiErr: any) {
        setImportProgress(0)
        setImportStatus('Ошибка')
        setError('Ошибка: ' + (apiErr?.message || String(apiErr)))
        setIsImporting(false)
      }
    } catch (e: any) {
      setImportProgress(0)
      setImportStatus('')
      setError('Ошибка: ' + (e?.message || String(e)))
      setIsImporting(false)
    }
  }

  const handleCalculate = async () => {
    if (!startDate || !endDate) {
      setError('Выберите диапазон дат')
      return
    }
    try {
      setIsLoading(true)
      setError(null)
      const startTime = Date.now()

      const result = await aggregate(startDate, endDate, frequency)
      setAggregateData(result.data)
      setCalcTime(Date.now() - startTime)
    } catch (e: any) {
      setError(e?.message || e?.toString() || 'Calculation failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExportCSV = () => {
    if (aggregateData.length === 0) return

    const headers = ['datetime', 'mean', 'std', 'min', 'max', 'count']
    const rows = aggregateData.map((d) => [
      d.datetime,
      d.mean,
      d.std,
      d.min,
      d.max,
      d.count,
    ])

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sealevel_${frequency}_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>SeaLevel</h1>
        <span className="subtitle">Анализ данных уровня моря</span>
      </header>

      <div className="controls">
        <div className="control-group">
          <button className="btn btn-primary" onClick={handleImport} disabled={isImporting}>
            {isImporting ? 'Загрузка...' : 'Загрузить файлы'}
          </button>
          
          {isImporting && (
            <div className="progress-section">
              <div className="progress-bar">
                <div className="progress-fill" style={{width: `${importProgress}%`}} />
              </div>
              <div className="progress-text">
                <span className="spinner"></span>
                {importStatus}
              </div>
            </div>
          )}

          <div className="files-list">
            {importFiles.slice(0, 5).map((f) => (
              <div key={f.filename} className={`file-item ${f.status}`}>
                <span className="filename">{f.filename}</span>
                <span className="status">{f.status}</span>
              </div>
            ))}
            {importFiles.length > 5 && (
              <div className="more-files">+{importFiles.length - 5} файлов</div>
            )}
          </div>
        </div>

        <div className="control-group">
          <label>Диапазон дат:</label>
          <div className="date-range">
            <input
              type="text"
              placeholder="ДД.ММ.ГГГГ"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span>–</span>
            <input
              type="text"
              placeholder="ДД.ММ.ГГГГ"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="control-group">
          <label>Дискретность:</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <button className="btn btn-success" onClick={handleCalculate} disabled={isLoading}>
            {isLoading ? 'Расчёт...' : 'Рассчитать'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error" style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <button onClick={() => setError(null)} style={{padding: '4px 8px', background: '#721c24', color: 'white', border: 'none', borderRadius: 2, cursor: 'pointer'}}>X</button>
          {error}
        </div>
      )}

      <div className="chart-container">
        <div className="chart-header">
          <h2>График уровня моря</h2>
          <button className="btn btn-secondary" onClick={handleExportCSV} disabled={aggregateData.length === 0}>
            Экспорт CSV
          </button>
        </div>

        <div className="chart">
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={aggregateData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="stdGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#006994" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#006994" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
              <XAxis
                dataKey="datetime"
                tickFormatter={(v) => {
                  try {
                    const d = new Date(v)
                    return `${d.getDate()}.${d.getMonth() + 1}`
                  } catch {
                    return ''
                  }
                }}
                stroke="#666"
              />
              <YAxis stroke="#666" />
              <Tooltip
                labelFormatter={(v) => new Date(v).toLocaleDateString('ru-RU')}
                formatter={(value) => {
                  const num = Array.isArray(value) ? value[0] : value
                  return [num?.toFixed(2)]
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="mean"
                stroke="#006994"
                strokeWidth={2}
                fill="url(#stdGradient)"
                name="mean"
              />
              <Line
                type="monotone"
                dataKey={(d) => d.mean + d.std}
                stroke="#ff7f0e"
                strokeWidth={1}
                strokeDasharray="5 5"
                name="+1σ"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey={(d) => d.mean - d.std}
                stroke="#ff7f0e"
                strokeWidth={1}
                strokeDasharray="5 5"
                name="-1σ"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <footer className="status-bar">
        <span>Диапазон: {dateRange.start || '–'} – {dateRange.end || '–'}</span>
        <span>Точек: {aggregateData.length}</span>
        <span>Время расчёта: {calcTime} мс</span>
      </footer>
    </div>
  )
}

export default App