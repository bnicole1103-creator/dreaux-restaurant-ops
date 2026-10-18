export type CrewMediaAsset={path:string;kind:'image'|'video';name:string}
export const crewMediaBucket='crew-chat-media'
export const crewMediaTypes:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'}
export const crewMediaAccept=Object.keys(crewMediaTypes).join(',')
export function validateCrewFiles(files:File[],existing=0){
 if(files.length+existing>6)throw Error('Choose up to six photos or videos per message.')
 for(const file of files){if(!crewMediaTypes[file.type])throw Error('Choose JPG, PNG, WebP, GIF, MP4, WebM or MOV files.');if(file.size<1||file.size>50*1024*1024)throw Error('Each attachment must be between 1 byte and 50 MB.')}
}
export function crewMediaLabel(media?:CrewMediaAsset[],body=''){
 const images=media?.filter(a=>a.kind==='image').length??0,videos=media?.filter(a=>a.kind==='video').length??0
 const label=[images?images+' photo'+(images===1?'':'s'):'',videos?videos+' video'+(videos===1?'':'s'):''].filter(Boolean).join(' · ')
 return label?(body==='Shared photos or videos.'||!body?label:label+' · '+body):body
}
