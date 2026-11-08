import { supabase } from './supabase'
import type { SalesShift,TargetInputs } from './salesTargets'
export async function loadSalesTargets(location:string,date:string){
 const [inputs,saved]=await Promise.all([
  supabase.rpc('sales_target_inputs',{p_location_id:location,p_date:date}),
  supabase.rpc('sales_targets_for_day',{p_location_id:location,p_date:date})]);
 if(inputs.error)throw inputs.error;
 if(saved.error)throw saved.error;
 if(saved.data?.manual_roster===true||saved.data?.allocation?.ready===true)return {inputs:{...inputs.data,locked_day:saved.data.locked?saved.data.allocation:inputs.data.locked_day} as TargetInputs,shifts:(saved.data.shifts??[]) as SalesShift[],syncedAt:saved.data.synced_at as string};
 // Never replace an explicitly reviewed app schedule with imported Close/BD flags.
 const crew=await supabase.rpc('crew_schedule_tools_load',{p_location_id:location,p_day:date});
 if(crew.error)throw Error('Saved schedule hours could not be checked: '+crew.error.message);
 if((crew.data?.override===true||crew.data?.dining_preserve===true)&&Array.isArray(crew.data.rows))return {inputs:inputs.data as TargetInputs,shifts:crew.data.rows.map((row:SalesShift)=>({...row,close:false,business_decline:false})) as SalesShift[],syncedAt:crew.data.confirmed_at as string};
 const schedule=await supabase.functions.invoke('home-schedule',{body:{location_id:location,date}});
 if(schedule.error)throw schedule.error;
 if(schedule.data?.configured===false)throw Error('Configure the 7shifts connection first.');
 if(schedule.data?.error)throw Error(schedule.data.error);
 if(schedule.data?.schedule_date!==date)throw Error('Deploy the updated home-schedule function to load the selected date.');
 if(!schedule.data?.synced_at)throw Error('Schedule sync is still running. Reload shortly.');
 return {inputs:inputs.data as TargetInputs,shifts:(schedule.data.rows??[]) as SalesShift[],syncedAt:schedule.data.synced_at as string};
}
