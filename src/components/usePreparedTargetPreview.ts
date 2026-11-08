import {usePrepareRelease} from './PrepareRelease'
import {preparedTargetPreview} from '../lib/preparedTargetPreview'
import type {SalesShift,TargetInputs} from '../lib/salesTargets'
export function usePreparedTargetPreview(inputs:TargetInputs|null,shifts:SalesShift[],date:string,scheduleOnly=false){const release=usePrepareRelease();try{return inputs?{...preparedTargetPreview(inputs,shifts,date,(release?.entries??[]).filter(e=>!scheduleOnly||e.operation!=='sales_target_save_weekday_totals')),error:''}:{inputs:null,shifts,queued:false,error:''}}catch(e){return {inputs,shifts,queued:true,error:String((e as Error).message??e)}}}
