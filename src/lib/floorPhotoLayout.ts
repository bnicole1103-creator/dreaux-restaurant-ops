export function floorRoomRatio(roomName:string){return /brut|bar/i.test(roomName)?0.9:1.05}
export function floorTableGeometry(table:{position_x:number;position_y:number;width:number;height:number}){
 const width=Math.max(5,Math.min(40,Number(table.width)||9)),height=Math.max(5,Math.min(30,Number(table.height)||9))
 const x=Math.max(0,Math.min(100-width,Number(table.position_x)||0)),y=Math.max(0,Math.min(100-height,Number(table.position_y)||0))
 return {left:`${x+width/2}%`,top:`${y+height/2}%`,width:`${width}%`,height:`${height}%`}
}
