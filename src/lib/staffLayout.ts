import type {DesignChange} from '../components/PageDesign'
export type Changes=Record<string,DesignChange>
export function mergeStaffChanges(...layers:Changes[]):Changes{const result:Changes={};for(const layer of layers)for(const[id,value]of Object.entries(layer??{}))result[id]={...result[id],...value};return result}
export function staffLayoutPreview(){return typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('staff-layout-edit')}
