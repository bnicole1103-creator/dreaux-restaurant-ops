import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  console.log(
    'SUPABASE URL PRESENT:',
    Boolean(process.env.VITE_SUPABASE_URL),
  )

  console.log(
    'SUPABASE KEY PRESENT:',
    Boolean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  )

  return {
    plugins: [react()],
  }
})