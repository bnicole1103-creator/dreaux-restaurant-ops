import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  console.log('SUPABASE URL PRESENT:', Boolean(env.VITE_SUPABASE_URL))
  console.log(
    'SUPABASE KEY PRESENT:',
    Boolean(env.VITE_SUPABASE_PUBLISHABLE_KEY),
  )

  return {
    plugins: [react()],
  }
})