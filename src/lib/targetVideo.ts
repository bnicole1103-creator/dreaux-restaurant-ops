export const targetVideoBucket='sales-target-videos'
export const targetVideoLimit=50*1024*1024
export function targetVideoFile(file:Pick<File,'name'|'type'|'size'>){
 const formats:Record<string,{mime:string;extension:string}>={
  'video/mp4':{mime:'video/mp4',extension:'mp4'},
  'video/quicktime':{mime:'video/quicktime',extension:'mov'},
  'video/webm':{mime:'video/webm',extension:'webm'},
 }
 const fallback:Record<string,string>={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'}
 const type=file.type||fallback[file.name.split('.').pop()?.toLowerCase()||'']
 const format=formats[type]
 if(!format)throw Error('Choose an MP4, MOV or WebM video. MP4 is recommended for playback across devices.')
 if(file.size<1||file.size>targetVideoLimit)throw Error('Choose a video up to 50 MB.')
 return format
}
