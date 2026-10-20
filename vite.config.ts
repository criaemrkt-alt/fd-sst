import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_APP_BASE || '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Cada publicação recebe nomes de arquivos novos. Assim o celular não
        // continua usando um bundle antigo depois que o Pages é atualizado.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'data-vendor': ['@supabase/supabase-js', '@tanstack/react-query'],
        },
      },
    },
  },
})
