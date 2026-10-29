import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {salesMoney} from '../lib/salesTargets'
import './MonthlyGoalPlanner.css'
export function useCalendarSalesGoals(location:string,from:string,to:string){
 const [goals,setGoals]=useState<Record<string,number>>({}),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{const update=()=>setRefresh(v=>v+1);window.addEventListener('sales-goal-plan-changed',update);window.addEventListener('focus',update);return()=>{window.removeEventListener('sales-goal-plan-changed',update);window.removeEventListener('focus',update)}},[])
 useEffect(()=>{let live=true;setGoals({});setError('');if(!location)return;void supabase.rpc('calendar_sales_goals',{p_location:location,p_from:from,p_to:to}).then(r=>{if(!live)return;if(r.error)setError('Daily sales goals unavailable: '+r.error.message);else setGoals(r.data??{})});return()=>{live=false}},[location,from,to,refresh])
 return {goals,error}
}
export function CalendarSalesGoal({amount}:{amount?:number}){return amount===undefined?null:<p className="calendar-sales-goal">Daily sales goal<strong>{salesMoney(Number(amount))}</strong></p>}
