import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import compression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    react(),
    // ОПТИМИЗАЦИЯ: Brotli compression для production
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 10240, // Только файлы > 10KB
      deleteOriginFile: false,
      verbose: false,
    }),
  ],
  
  server: {
    port: 5173,
    strictPort: true,
  },
  
  // ОПТИМИЗАЦИЯ: Production build settings
  build: {
    // Минимизация целевого окружения для лучшей оптимизации
    target: 'ES2020',
    
    // Включить минификацию
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Удалить console.log в prod
        passes: 2,          // Несколько проходов минификации
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
    
    // Оптимизация rollup
    rollupOptions: {
      output: {
        // Code splitting: отделить vendor библиотеки
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-tauri': ['@tauri-apps/api'],
          'vendor-uplot': ['uplot'],
          'vendor-charts': ['recharts'],
        },
        // Оптимизировать размер чанков
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name]-[hash].js',
      },
    },
    
    // Chunk size warning limit - нужен для больших приложений
    chunkSizeWarningLimit: 1000,
    
    // Source maps только для dev
    sourcemap: false,
    
    // Optimizate CSS отдельно
    cssCodeSplit: true,
    
    // Inline small assets
    assetsInlineLimit: 4096,
    
    // Report compressed size
    reportCompressedSize: true,
  },
  
  // ОПТИМИЗАЦИЯ: Зависимости
  optimizeDeps: {
    // Явно указать зависимости для предварительной обработки
    include: [
      'react',
      'react-dom',
      'uplot',
      'zustand',
      'recharts',
      '@tauri-apps/api',
    ],
    // Использовать эмодули где возможно
    esbuildOptions: {
      target: 'ES2020',
    },
  },
})