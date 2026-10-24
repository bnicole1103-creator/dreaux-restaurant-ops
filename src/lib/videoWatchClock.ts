/** Counts observed playback, not elapsed time with a player sitting on screen. */
export class VideoWatchClock {
 total=0
 private at:number|null=null
 private position=0
 private eligible=false
 sample(at:number,position:number,eligible:boolean,rate=1,seeking=false){
  if(this.at!==null&&this.eligible&&!seeking&&Number.isFinite(position)&&rate>0){
   const wall=Math.max(0,(at-this.at)/1000),media=position-this.position
   // Ignore discontinuities (scrubbing); stalls contribute zero.
   if(wall<=5&&media>0&&media<=wall*rate+.5)this.total+=Math.min(wall,media/rate)
  }
  this.at=at;this.position=position;this.eligible=eligible&&!seeking
  return this.total
 }
}
export function watchTime(seconds:number){
 const n=Math.max(0,Math.floor(Number(seconds)||0)),hours=Math.floor(n/3600)
 return hours?hours+':'+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0'):Math.floor(n/60)+':'+String(n%60).padStart(2,'0')
}
