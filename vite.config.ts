import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_APP_BASE || '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Mantém os caminhos dos arquivos estáveis entre publicações. Isso evita tela branca
        // quando o navegador ainda possui o index.html da publicação anterior em cache.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'data-vendor': ['@supabase/supabase-js', '@tanstack/react-query'],
        },
      },
    },
  },
})
