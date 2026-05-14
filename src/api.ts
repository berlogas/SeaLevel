import { DataPoint, ImportFile } from './store'
import { invoke } from '@tauri-apps/api/core'

const isDev = import.meta.env.DEV
const BASE_URL = 'http://127.0.0.1:8000'

async function httpFetch(path: string, options?: RequestInit) {
  const { fetch } = await import('@tauri-apps/plugin-http')
  return fetch(`${BASE_URL}${path}`, options)
}

export async function importFiles(
  files: string[],
  halfWindow: number = 500,
  k: number = 3.0,  // IQR множитель
  filterOutliers: boolean = false
): Promise<{ status: string; files_processed: number; records_count: number; outliers_removed: number }> {
  if (isDev) {
    const response = await httpFetch('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        files, 
        filter_outliers: filterOutliers,
        half_window: halfWindow,
        k,
      }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  
  try {
    return await invoke('import_files', { 
      payload: {
        files, 
        filterOutliers,
        halfWindow,
        k,
      }
    })
  } catch (e) {
    console.error('importFiles error:', e)
    throw e
  }
}

interface AggregateResult {
  data: DataPoint[]
  stats: { count: number; total_records: number }
}

export async function aggregate(
  startDate: string,
  endDate: string,
  frequency: string
): Promise<AggregateResult> {
  if (isDev) {
    const response = await httpFetch('/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate, frequency }),
    })
    if (!response.ok) throw new Error('Aggregation failed')
    const result = await response.json() as AggregateResult
    return result
  }
  
  try {
    const result = await invoke('aggregate', {
      startDate,
      endDate,
      freq: frequency,
    }) as AggregateResult
    return result
  } catch (e) {
    console.error('aggregate error:', e)
    throw e
  }
}

export async function getImportLog(): Promise<ImportFile[]> {
  if (isDev) {
    const response = await httpFetch('/import_log')
    if (!response.ok) throw new Error('Failed to get import log')
    return response.json()
  }

  try {
    return await invoke('get_import_log')
  } catch (e) {
    console.error('getImportLog error:', e)
    return []
  }
}

export async function getDateRange(): Promise<{ start: string | null; end: string | null }> {
  if (isDev) {
    const response = await httpFetch('/date_range')
    if (!response.ok) throw new Error('Failed to get date range')
    return response.json()
  }
  
  try {
    return await invoke('get_date_range')
  } catch (e) {
    console.error('getDateRange error:', e)
    return { start: null, end: null }
  }
}

export async function exportFullData(
  startDate: string,
  endDate: string,
  frequency: string
): Promise<AggregateResult> {
  if (isDev) {
    const response = await httpFetch('/export_full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate, frequency }),
    })
    if (!response.ok) throw new Error('Export failed')
    return response.json()
  }
  
  try {
    return await invoke('export_full_data', {
      startDate,
      endDate,
      freq: frequency,
    })
  } catch (e) {
    console.error('exportFullData error:', e)
    throw e
  }
}

export async function exportMonthData(
  year: number,
  month: number
): Promise<string> {
  try {
    return await invoke('export_month_data', {
      year,
      month,
    })
  } catch (e) {
    console.error('exportMonthData error:', e)
    throw e
  }
}

export async function getAvailableYears(): Promise<number[]> {
  try {
    return await invoke('get_available_years')
  } catch (e) {
    console.error('getAvailableYears error:', e)
    return []
  }
}

export async function clearAggregateCache(): Promise<void> {
  if (isDev) {
    const response = await httpFetch('/clear_cache', { method: 'POST' })
    if (!response.ok) throw new Error('Failed to clear cache')
    return
  }

  try {
    await invoke('clear_aggregate_cache')
  } catch (e) {
    console.error('clearAggregateCache error:', e)
    throw e
  }
}

