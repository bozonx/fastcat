import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import path from 'path';

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Treat all tags with 'fastcat-' as custom elements
          isCustomElement: (tag: string) => tag.includes('fastcat-')
        }
      },
      // This is important for Shadow DOM support with defineCustomElement
      customElement: true 
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '#app': fileURLToPath(new URL('./src/utils/lib-compat.ts', import.meta.url)),
      '#imports': fileURLToPath(new URL('./src/utils/lib-compat.ts', import.meta.url)),
      '#i18n': 'vue-i18n',
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.lib.ts'),
      name: 'FastcatEditor',
      fileName: (format: string) => `fastcat-editor.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // In Stage 2, Option A, we bundle almost everything.
      // But we might want to exclude very large binaries if they are already on CDN.
      external: [], 
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: 'dist-lib',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
