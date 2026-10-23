export function mediaLink(raw:string){
 let u:URL;try{u=new URL(raw)}catch{return null}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null
 const host=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean)
 let embed='',label=host
 const youtube=['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)
 if(youtube){const id=host==='youtu.be'?parts[0]:['shorts','embed','live'].includes(parts[0])?parts[1]:u.searchParams.get('v');if(id&&/^[\w-]{11}$/.test(id)){embed='https://www.youtube-nocookie.com/embed/'+id;label='YouTube video'}}
 if(['instagram.com','www.instagram.com'].includes(host)&&['reel','reels','p'].includes(parts[0])&&/^[\w-]+$/.test(parts[1]??'')){embed='https://www.instagram.com/'+(parts[0]==='reels'?'reel':parts[0])+'/'+parts[1]+'/embed/';label='Instagram post / reel'}
 if(['tiktok.com','www.tiktok.com'].includes(host)&&parts[1]==='video'&&/^\d{10,25}$/.test(parts[2]??'')){embed='https://www.tiktok.com/player/v1/'+parts[2];label='TikTok video'}
 return {url:u.href,embed,label}
}
export function splitMediaLinks(text:string){return text.split(/(https?:\/\/[^\s<>]+)/g).flatMap(part=>{if(!/^https?:\/\//.test(part))return [{text:part,link:null}];const trimmed=part.replace(/[.,!?;:]+$/,'');const suffix=part.slice(trimmed.length);return [{text:trimmed,link:mediaLink(trimmed)},...(suffix?[{text:suffix,link:null}]:[])]})}
