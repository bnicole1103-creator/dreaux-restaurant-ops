// startup-guard-v1: report module initialization failures before loading the app.
import {showStartupError} from './startupError'
const missing=[]
if(!import.meta.env.VITE_SUPABASE_URL)missing.push('VITE_SUPABASE_URL')
if(!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
if(missing.length){showStartupError('Missing app configuration: '+missing.join(', ')+'. Add these existing project values to the Vercel Preview environment, then redeploy this branch. Never use a service-role key in frontend settings.')}
else{void import('./appBootstrap').catch(showStartupError)}
