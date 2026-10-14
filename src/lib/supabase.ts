import {createStaffPreviewClient,staffPreviewActive} from './staffPreviewClient'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables.')
}

const realStorage={getItem:localStorage.getItem.bind(localStorage),setItem:localStorage.setItem.bind(localStorage),removeItem:localStorage.removeItem.bind(localStorage)}
const normalClient = createClient(supabaseUrl, supabasePublishableKey,{auth:{storage:realStorage,autoRefreshToken:!staffPreviewActive,detectSessionInUrl:!staffPreviewActive},global:{fetch:window.fetch.bind(window)}})
export const supabase = staffPreviewActive ? createStaffPreviewClient(normalClient,supabaseUrl,supabasePublishableKey) : normalClient
