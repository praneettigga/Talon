import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/v1': 'http://127.0.0.1:3001' } },
  optimizeDeps: { include: ['cytoscape', 'react-force-graph-3d'] },
  build: {
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three-vendor';
          if (id.includes('/node_modules/cytoscape/')) return 'cytoscape-vendor';
          if (id.includes('/node_modules/react-force-graph-3d/') || id.includes('/node_modules/3d-force-graph/') ||
              id.includes('/node_modules/d3-force-3d/') || id.includes('/node_modules/three-spritetext/')) return 'force-graph-vendor';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react-vendor';
        },
      },
    },
  },
});
