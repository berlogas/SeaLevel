import { create } from 'zustand'

export interface DataPoint {
  datetime: string
  mean: number
  std: number
  min: number
  max: number
  count: number
}

export interface ImportFile {
  filename: string
  status: 'queued' | 'indexing' | 'ready' | 'error'
  records_count: number
  imported_at: string
}

interface AppState {
  apiPort: number
  setApiPort: (port: number) => void
  
  importFiles: ImportFile[]
  setImportFiles: (files: ImportFile[]) => void
  
  isImporting: boolean
  setIsImporting: (importing: boolean) => void
  
  importProgress: number
  setImportProgress: (progress: number) => void
  
  importStatus: string
  setImportStatus: (status: string) => void
  
  startDate: string
  setStartDate: (date: string) => void
  
  endDate: string
  setEndDate: (date: string) => void
  
  frequency: string
  setFrequency: (freq: string) => void
  
  aggregateData: DataPoint[]
  setAggregateData: (data: DataPoint[]) => void
  
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  
  dateRange: { start: string | null; end: string | null }
  setDateRange: (range: { start: string | null; end: string | null }) => void
  
  error: string | null
  setError: (error: string | null) => void
  
  showFilesModal: boolean
  setShowFilesModal: (show: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  apiPort: 8000,
  setApiPort: (port) => set({ apiPort: port }),
  
  importFiles: [],
  setImportFiles: (files) => set({ importFiles: files }),
  
  isImporting: false,
  setIsImporting: (importing) => set({ isImporting: importing }),
  
  importProgress: 0,
  setImportProgress: (progress) => set({ importProgress: progress }),
  
  importStatus: '',
  setImportStatus: (status) => set({ importStatus: status }),
  
  startDate: '',
  setStartDate: (date) => set({ startDate: date }),
  
  endDate: '',
  setEndDate: (date) => set({ endDate: date }),
  
  frequency: 'day',
  setFrequency: (freq) => set({ frequency: freq }),
  
  aggregateData: [],
  setAggregateData: (data) => set({ aggregateData: data }),
  
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  dateRange: { start: null, end: null },
  setDateRange: (range) => set({ dateRange: range }),
  
  error: null,
  setError: (error) => set({ error: error }),
  
  showFilesModal: false,
  setShowFilesModal: (show) => set({ showFilesModal: show }),
}))