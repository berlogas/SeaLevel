import { DataPoint, ImportFile } from './store'

const BASE_URL = 'http://127.0.0.1:8000'

export async function importFiles(files: string[]): Promise<{ status: string; files_processed: number; records_count: number }> {
  try {
    const { fetch } = await import('@tauri-apps/plugin-http')
    
    const response = await fetch(`${BASE_URL}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    return await response.json()
  } catch (e) {
    console.error('importFiles error:', e)
    throw e
  }
}

export async function aggregate(
  startDate: string, 
  endDate: string, 
  frequency: string
): Promise<{ data: DataPoint[]; stats: { count: number; total_records: number } }> {
  const { fetch } = await import('@tauri-apps/plugin-http')
  
  const response = await fetch(`${BASE_URL}/aggregate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, end_date: endDate, frequency }),
  })
  
  if (!response.ok) throw new Error('Aggregation failed')
  return response.json()
}

export async function getImportLog(): Promise<ImportFile[]> {
  const { fetch } = await import('@tauri-apps/plugin-http')
  
  const response = await fetch(`${BASE_URL}/import_log`)
  if (!response.ok) throw new Error('Failed to get import log')
  return response.json()
}

export async function getDateRange(): Promise<{ start: string | null; end: string | null }> {
  const { fetch } = await import('@tauri-apps/plugin-http')
  
  const response = await fetch(`${BASE_URL}/date_range`)
  if (!response.ok) throw new Error('Failed to get date range')
  return response.json()
}