import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {createHandler} from './handler.ts';
Deno.serve(createHandler({env:name=>Deno.env.get(name),fetch,client:auth=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})}));
