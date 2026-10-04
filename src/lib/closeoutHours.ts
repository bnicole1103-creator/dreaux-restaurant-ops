export function closeoutHours(clockIn:string,clockOut:string):number|null {
  const parse=(value:string)=>{const m=/^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);if(!m||Number(m[1])>23||Number(m[2])>59)return null;return Number(m[1])*60+Number(m[2])}
  const start=parse(clockIn),end=parse(clockOut)
  if(start===null||end===null)return null
  const minutes=(end-start+1440)%1440
  return minutes>0&&minutes<=1080?minutes/60:null
}
