import {useState} from 'react'
import {createPortal} from 'react-dom'
import {TaskDialog} from './TaskDialog'
import {splitMediaLinks,type mediaLink} from '../lib/mediaLinks'
import './MediaLinkText.css'
export function MediaLinkText({text}:{text:string}){
 const [opened,setOpened]=useState<NonNullable<ReturnType<typeof mediaLink>>|null>(null)
 return <>{splitMediaLinks(text).map((part,i)=>part.link?<a key={i} href={part.link.url} onClick={e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();setOpened(part.link)}} className="media-inline-link">{part.text}</a>:part.text)}{opened&&createPortal(<TaskDialog title={opened.label} onClose={()=>setOpened(null)}><div className="media-link-popup">{opened.embed?<><iframe key={opened.url} src={opened.embed} title={opened.label} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"/><p>If the platform asks for a login or blocks playback, use Open link below.</p></>:<p>This website opens in your browser. Close this popup to return to the same spot in the app.</p>}<a href={opened.url} target="_blank" rel="noopener noreferrer" className="primary-button">Open link ↗</a></div></TaskDialog>,document.body)}</>
}
